package com.oneorthree.realtime.membership.client;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 HTTP로 내부 섬 목록의 자격·본문·오류 계약을 검증한다. */
class GroupClientTest {

    private static final String JWT_SECRET = "group-client-test-secret-key-at-least-256-bits-long";
    private static final String SERVICE_TOKEN = "test-realtime-to-data";
    private static final UUID USER_ID = UUID.randomUUID();
    private static final String BEARER = bearer("access", Instant.now().plusSeconds(3600));

    private HttpServer server;
    private GroupClient groupClient;
    private final AtomicReference<Responder> responder = new AtomicReference<>();
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastUserId = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/users/" + USER_ID + "/islands", exchange -> {
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            lastUserId.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            responder.get().respond(exchange);
        });
        server.start();
        groupClient = new GroupClient(baseUrl(), 1000, SERVICE_TOKEN, new JwtValidator(JWT_SECRET));
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    @DisplayName("내부 섬 목록의 items.id를 읽고 사용자 AT 대신 서비스 자격과 검증된 주체를 보낸다")
    void fetchesCurrentIslandsWithServiceCredential() {
        UUID islandId = UUID.randomUUID();
        respondWith(200, "{\"items\":[{\"id\":\"" + islandId
                + "\",\"name\":\"우리 섬\",\"membershipStatus\":\"active\"}],"
                + "\"currentIslandId\":null,\"lossReason\":null}");

        GroupClient.Membership membership = groupClient.fetchMyGroupIds(BEARER);

        assertThat(membership.groupIds()).containsExactly(islandId);
        assertThat(membership.cacheable()).isTrue();
        assertThat(lastAuthorization.get()).isEqualTo("Bearer " + SERVICE_TOKEN).isNotEqualTo(BEARER);
        assertThat(lastUserId.get()).isEqualTo(USER_ID.toString());
    }

    @Test
    @DisplayName("items가 빈 배열이면 무소속이며 캐시할 수 있다")
    void emptyMembershipIsNotAnError() {
        respondWith(200, "{\"items\":[],\"currentIslandId\":null,\"lossReason\":\"LEFT\"}");

        GroupClient.Membership membership = groupClient.fetchMyGroupIds(BEARER);

        assertThat(membership.groupIds()).isEmpty();
        assertThat(membership.cacheable()).isTrue();
    }

    @Test
    @DisplayName("본문·items·id 누락은 무소속이 아니며 방문자 자격으로 캐시할 수 없다")
    void malformedSuccessIsNotAnEmptyMembership() {
        for (Responder malformed : new Responder[] {
                exchange -> exchange.sendResponseHeaders(204, -1),
                exchange -> exchange.sendResponseHeaders(200, -1),
                json(200, "{}"), json(200, "{\"items\":null}"),
                json(200, "{\"items\":[{\"name\":\"이름만\"}]}"),
                json(200, "{\"items\":[null]}")}) {
            respondWith(malformed);

            GroupClient.Membership membership = groupClient.fetchMyGroupIds(BEARER);

            assertThat(membership.groupIds()).isEmpty();
            assertThat(membership.cacheable()).isFalse();
        }
    }

    @Test
    @DisplayName("무효·만료·refresh 자격은 내부 호출 전에 거절한다")
    void invalidAccessCredentialDoesNotReachData() {
        for (String invalid : new String[] {null, "not-bearer", "Bearer invalid",
                bearer("access", Instant.now().minusSeconds(60)),
                bearer("refresh", Instant.now().plusSeconds(3600))}) {
            assertThatThrownBy(() -> groupClient.fetchMyGroupIds(invalid))
                    .isInstanceOf(UpstreamRejectedCredentialException.class);
        }
        assertThat(lastAuthorization.get()).isNull();
    }

    @Test
    @DisplayName("Data의 USER_NOT_FOUND만 사용자 자격 거절로 전달한다")
    void withdrawnUserCannotBeTreatedAsAVisitor() {
        respondWith(404, "{\"code\":\"USER_NOT_FOUND\",\"message\":\"사용자가 없습니다\"}");

        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamRejectedCredentialException.class);
    }

    @Test
    @DisplayName("내부 서비스 401·403 및 경로 404·5xx는 사용자 판정이 아닌 상류 장애다")
    void serviceErrorsCannotBeCachedOrTriggerUserRefresh() {
        for (int status : new int[] {400, 401, 403, 404, 500, 503}) {
            respondWith(status, "{\"code\":\"INTERNAL_ERROR\"}");
            assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                    .isInstanceOf(UpstreamUnavailableException.class);
        }
    }

    @Test
    @DisplayName("깨진 성공 본문과 옛 공개 API 배열은 현재 섬 목록이 아니다")
    void brokenSuccessBodyIsNotSilentDenial() {
        for (String body : new String[] {"not json at all", "[]"}) {
            respondWith(200, body);
            assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                    .isInstanceOf(UpstreamUnavailableException.class);
        }
    }

    @Test
    @DisplayName("비어 있거나 치환되지 않은 서비스 자격으로는 기동하지 않는다")
    void rejectsMissingServiceCredential() {
        for (String invalid : new String[] {null, "", " ", "${SVC_TOKEN_REALTIME_TO_DATA}", "line\nbreak"}) {
            assertThatThrownBy(() -> new GroupClient(baseUrl(), 1000, invalid, new JwtValidator(JWT_SECRET)))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    @DisplayName("헤더 뒤 본문이 멈춰도 읽기 타임아웃 안에 실패한다")
    void stalledBodyFailsWithinReadTimeout() {
        respondWith(exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, 100);
            exchange.getResponseBody().write('{');
            exchange.getResponseBody().flush();
            pause(6000);
        });
        long started = System.nanoTime();
        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
        assertThat(java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)).isLessThan(3000L);
    }

    @Test
    @DisplayName("상류가 응답하지 않으면 채널 스레드를 무한 대기시키지 않는다")
    void timesOut() {
        respondWith(exchange -> pause(3000));

        long started = System.currentTimeMillis();
        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
        assertThat(System.currentTimeMillis() - started).isLessThan(2500);
    }

    @Test
    @DisplayName("연결 거부는 무소속이 아닌 상류 장애다")
    void connectionRefusedIsNotSilentDenial() {
        server.stop(0);

        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static String bearer(String type, Instant expiresAt) {
        return "Bearer " + Jwts.builder().subject(USER_ID.toString()).claim("type", type)
                .expiration(Date.from(expiresAt))
                .signWith(Keys.hmacShaKeyFor(JWT_SECRET.getBytes(StandardCharsets.UTF_8))).compact();
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void respondWith(int status, String body) {
        respondWith(json(status, body));
    }

    private static Responder json(int status, String body) {
        return exchange -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        };
    }

    private void respondWith(Responder r) {
        responder.set(exchange -> {
            try {
                r.respond(exchange);
            } finally {
                exchange.close();
            }
        });
    }

    @FunctionalInterface
    private interface Responder {
        void respond(HttpExchange exchange) throws IOException;
    }
}

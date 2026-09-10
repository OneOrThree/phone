package com.oneorthree.chat.membership.client;

import com.oneorthree.chat.common.exception.UpstreamUnavailableException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 상류 응답을 <b>실제 HTTP</b> 로 받아 본다 — JDK 내장 서버라 새 의존성이 없다.
 *
 * <p>이 클래스에서 확인하려는 것은 「어느 실패를 «아니오»로 접고 어느 실패를 «모르겠다»로 올리는가」다.
 * 그 갈림은 RestClient 가 <b>언제 본문을 읽는지</b>에 달려 있어서, 목으로는 한 글자도 검증되지 않는다:
 * 401 의 본문은 에러 봉투인데 그걸 {@code List<GroupRef>} 로 읽으려 들면 변환이 터지고, 그 예외를
 * 뭉뚱그려 잡으면 <b>「판정 완료(비멤버)」가 「판정 불가(503)」로 뒤집힌다.</b>
 */
class GroupClientTest {

    private static final String BEARER = "Bearer test-token";

    private HttpServer server;
    private GroupClient groupClient;
    private final AtomicReference<Responder> responder = new AtomicReference<>();
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/groups", exchange -> {
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            responder.get().respond(exchange);
        });
        server.start();
        groupClient = new GroupClient("http://127.0.0.1:" + server.getAddress().getPort(), 1000);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    @DisplayName("200 이면 groupId 만 뽑는다 — 나머지 필드는 몰라도 된다")
    void extractsGroupIdsOnly() {
        UUID groupId = UUID.randomUUID();
        // 상류의 실제 응답 모양(GroupSummaryResponse)에는 필드가 더 많다. 채팅이 아는 게 적을수록
        // 상류가 자유롭게 바뀔 수 있다는 계약을 여기서 확인한다.
        respondWith(200, "[{\"groupId\":\"" + groupId + "\",\"name\":\"우리 섬\",\"currentMembers\":3,"
                + "\"role\":\"MEMBER\",\"isPrivate\":false}]");

        assertThat(groupClient.fetchMyGroupIds(BEARER)).containsExactly(groupId);
    }

    @Test
    @DisplayName("Authorization 헤더를 «통째로» 전달한다 — 접두를 떼면 상류가 401 을 준다")
    void forwardsAuthorizationHeaderVerbatim() {
        respondWith(200, "[]");

        groupClient.fetchMyGroupIds(BEARER);

        assertThat(lastAuthorization.get()).isEqualTo(BEARER);
    }

    @Test
    @DisplayName("빈 배열은 「아무 섬에도 안 속함」이다 — 예외가 아니다")
    void emptyMembershipIsNotAnError() {
        respondWith(200, "[]");

        assertThat(groupClient.fetchMyGroupIds(BEARER)).isEmpty();
    }

    @Test
    @DisplayName("401 은 «상류가 내린 판정»이라 빈 집합으로 접는다 — 본문이 에러 봉투여도 터지지 않는다")
    void unauthorizedFoldsToEmpty() {
        // 이 본문이 핵심이다. List<GroupRef> 로 읽으려 들면 변환이 터지고, 그러면 503 으로 뒤집힌다.
        respondWith(401, "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다.\"}");

        assertThat(groupClient.fetchMyGroupIds(BEARER)).isEmpty();
    }

    @Test
    @DisplayName("403 도 마찬가지로 빈 집합")
    void forbiddenFoldsToEmpty() {
        respondWith(403, "{\"code\":\"FORBIDDEN\",\"message\":\"권한이 없습니다.\"}");

        assertThat(groupClient.fetchMyGroupIds(BEARER)).isEmpty();
    }

    @Test
    @DisplayName("400·404 는 접지 않는다 — 이 유저에 대한 판정이 아니라 «우리 쪽이 어긋났다»는 신호다")
    void otherClientErrorsAreNotSilentDenial() {
        // 401/403 과 «같은 4xx» 라는 이유로 함께 접으면, 배선 사고(엔드포인트 이동·요청 형식 변경)가
        // 「전원 비멤버」라는 조용한 차단으로 나타난다.
        respondWith(404, "{\"code\":\"NOT_FOUND\"}");
        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);

        respondWith(400, "{\"code\":\"INVALID_REQUEST\"}");
        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("5xx 는 «모르겠다»다 — 빈 집합으로 접으면 장애가 조용한 전원 차단이 된다")
    void serverErrorIsNotSilentDenial() {
        respondWith(500, "{\"code\":\"INTERNAL_ERROR\"}");

        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("200 인데 본문이 깨졌으면 그것도 «모르겠다»다")
    void brokenSuccessBodyIsNotSilentDenial() {
        respondWith(200, "not json at all");

        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("상류가 답하지 않으면 타임아웃 뒤 «모르겠다» — 채널 스레드가 영영 잠기지 않는다")
    void timesOut() {
        respondWith(exchange -> {
            try {
                Thread.sleep(3000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        long startedAt = System.currentTimeMillis();
        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
        // 무제한이었다면 3초를 다 기다렸을 것이다. 타임아웃 1초 + 여유.
        assertThat(System.currentTimeMillis() - startedAt).isLessThan(2500);
    }

    @Test
    @DisplayName("상류가 아예 없으면(연결 거부) «모르겠다»")
    void connectionRefusedIsNotSilentDenial() {
        server.stop(0);

        assertThatThrownBy(() -> groupClient.fetchMyGroupIds(BEARER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private void respondWith(int status, String body) {
        respondWith(exchange -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
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

package com.oneorthree.realtime.block.client;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 차단 목록 조회의 엄격성 (GROMO-2182) — <b>계약 밖의 응답은 전부 판정 불가</b>로 올라가야 한다.
 *
 * <p>여기서 빈 집합이 새면 fail-closed 가 무너진다: 호출자는 빈 집합을 «아무도 차단 안 함»으로 읽고 전부
 * 보낸다. 그래서 실제 HTTP(JDK 내장 서버)로 상태·Content-Type·redirect·본문 형식을 하나씩 본다.
 */
class BlockClientTest {

    private static final UUID USER = UUID.fromString("019f16a0-0000-7000-8000-000000000002");
    private static final UUID BLOCKED = UUID.fromString("019f16a0-0000-7000-8000-000000000003");
    private static final String TOKEN = "svc-realtime-to-data";

    private HttpServer server;
    private BlockClient client;
    private final AtomicReference<String> body = new AtomicReference<>("[]");
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> contentType = new AtomicReference<>("application/json");
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastSubject = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/users", exchange -> {
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            lastSubject.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            lastPath.set(exchange.getRequestURI().getPath());
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
            if (contentType.get() != null) {
                exchange.getResponseHeaders().add("Content-Type", contentType.get());
            }
            if (status.get() == 302) {
                exchange.getResponseHeaders().add("Location", "/internal/users/other");
            }
            exchange.sendResponseHeaders(status.get(), bytes.length == 0 ? -1 : bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        // 요청을 붙드는 테스트가 있어 요청마다 스레드를 쓴다(기본은 한 스레드로 순차 처리).
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        client = new BlockClient("http://127.0.0.1:" + server.getAddress().getPort(), TOKEN, 1000);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    @DisplayName("정상 응답의 id 만 읽고, 서비스 토큰과 주체를 싣는다")
    void readsIdsWithServiceCredentials() {
        body.set("[{\"id\":\"" + BLOCKED + "\",\"name\":\"상대\"},{\"id\":\"" + USER + "\",\"name\":null}]");

        assertThat(client.fetchBlockedIds(USER)).containsExactlyInAnyOrder(BLOCKED, USER);
        assertThat(lastAuthorization.get()).isEqualTo("Bearer " + TOKEN);
        assertThat(lastSubject.get()).isEqualTo(USER.toString());
        assertThat(lastPath.get()).isEqualTo("/internal/users/" + USER + "/blocks");
    }

    @Test
    @DisplayName("정상 조회의 빈 배열은 «아무도 차단 안 함»이다")
    void emptyArrayIsAnAnswer() {
        assertThat(client.fetchBlockedIds(USER)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {204, 302, 401, 403, 404, 500, 503})
    @DisplayName("200 이 아니면(redirect 포함) 판정 불가다 — 오류를 빈 집합으로 접지 않는다")
    void nonOkStatusIsUnavailable(int code) {
        status.set(code);
        body.set(code == 204 ? "" : "[]");

        assertThatThrownBy(() -> client.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("Content-Type 이 JSON 이 아니면 판정 불가다")
    void nonJsonContentTypeIsUnavailable() {
        contentType.set("text/plain");

        assertThatThrownBy(() -> client.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        "null",
        "{}",
        "[1]",
        "[{}]",
        "[{\"name\":\"x\"}]",
        "[{\"id\":\"019f16a0-0000-7000-8000-000000000003\",\"extra\":1}]",
        "[{\"id\":\"019f16a0-0000-7000-8000-000000000003\",\"id\":\"019f16a0-0000-7000-8000-000000000003\"}]",
        "[{\"id\":\"019f16a0-0000-7000-8000-000000000003\"}] []",
        "[{\"id\":\"not-a-uuid\"}]",
        "[{\"id\":\"1-1-1-1-1\"}]",
        "[{\"id\":\"019F16A0-0000-7000-8000-000000000003\"}]",
        "[{\"id\":123}]",
        "[{\"id\":\"019f16a0-0000-7000-8000-000000000003\",\"name\":7}]",
        "[{\"id\":\"019f16a0-0000-7000-8000-000000000003\""
    })
    @DisplayName("빈 본문·모르는 필드·중복 키·뒤따르는 토큰·비정규 UUID·타입 오류는 판정 불가다")
    void malformedBodyIsUnavailable(String malformed) {
        body.set(malformed);

        assertThatThrownBy(() -> client.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("본문이 상한을 넘으면 판정 불가다")
    void oversizedBodyIsUnavailable() {
        body.set("[" + " ".repeat(BlockClient.MAX_RESPONSE_BYTES) + "]");

        assertThatThrownBy(() -> client.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("대상·자격이 배선되지 않았으면 판정 불가다")
    void unconfiguredIsUnavailable() {
        assertThatThrownBy(() -> new BlockClient("", TOKEN, 1000).fetchBlockedIds(USER))
                .isInstanceOf(UpstreamUnavailableException.class);
        assertThatThrownBy(() -> new BlockClient("http://127.0.0.1:1", "", 1000).fetchBlockedIds(USER))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("본문을 조금씩 흘리는 상류는 총 deadline 에서 끊는다 — 읽기 한 번의 timeout 만으로는 못 막는다")
    void slowDripBodyHitsTheTotalDeadline() throws Exception {
        server.createContext("/internal/users/drip", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, 0);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write('[');
                for (int i = 0; i < 40; i++) {
                    out.write(' ');
                    out.flush();
                    Thread.sleep(100);
                }
                out.write(']');
            } catch (InterruptedException | IOException e) {
                // 클라이언트가 끊었다.
            }
        });
        // read timeout(300ms)보다 짧은 간격으로 흘리지만 총 4초 — deadline(300ms)에서 끊겨야 한다.
        BlockClient slow = new BlockClient("http://127.0.0.1:" + server.getAddress().getPort() + "/internal/users/drip",
                TOKEN, 300);
        long started = System.nanoTime();

        assertThatThrownBy(() -> slow.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
        assertThat(java.time.Duration.ofNanos(System.nanoTime() - started)).isLessThan(java.time.Duration.ofSeconds(2));
    }

    @Test
    @DisplayName("동시 호출 상한을 넘으면 기다리지 않고 판정 불가다")
    void inFlightCapRejectsWithoutWaiting() throws Exception {
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        server.createContext("/hold/internal/users", exchange -> {
            entered.countDown();
            try {
                release.await(5, java.util.concurrent.TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            byte[] bytes = "[]".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        BlockClient single = new BlockClient("http://127.0.0.1:" + server.getAddress().getPort() + "/hold", TOKEN,
                5000, 1);
        java.util.concurrent.CompletableFuture<java.util.Set<UUID>> first =
                java.util.concurrent.CompletableFuture.supplyAsync(() -> single.fetchBlockedIds(USER));
        assertThat(entered.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();

        assertThatThrownBy(() -> single.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
        release.countDown();
        assertThat(first.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEmpty();
        // 자리를 돌려줬으므로 다음 호출은 통과한다.
        assertThat(single.fetchBlockedIds(USER)).isEmpty();
    }

    @Test
    @DisplayName("상류가 응답하지 않으면 판정 불가다")
    void unreachableIsUnavailable() {
        server.stop(0);

        assertThatThrownBy(() -> client.fetchBlockedIds(USER)).isInstanceOf(UpstreamUnavailableException.class);
    }
}

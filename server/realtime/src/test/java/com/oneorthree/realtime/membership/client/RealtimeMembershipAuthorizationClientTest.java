package com.oneorthree.realtime.membership.client;

import com.oneorthree.realtime.auth.VerifiedAccessIdentity;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.config.RealtimeAuthorizationProperties;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.BufferedInputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 TCP로 응답 body 전체 예산·자격 분리·엄격한 단일 판정·동시 호출 상한을 검증한다. */
class RealtimeMembershipAuthorizationClientTest {
    private static final String PATH = "/internal/realtime/membership-authorization";
    private static final String SERVICE_TOKEN = "test-service-only-credential";
    private final VerifiedAccessIdentity identity = new VerifiedAccessIdentity(
            UUID.randomUUID(), UUID.randomUUID(), 4L, Instant.now().plusSeconds(3600));
    private final UUID island = UUID.randomUUID();
    private final AtomicReference<Responder> responder = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();
    private final AtomicReference<String> receivedBody = new AtomicReference<>();
    private final AtomicReference<java.util.List<String>> authorization = new AtomicReference<>();
    private final AtomicReference<String> subject = new AtomicReference<>();
    private final AtomicReference<String> method = new AtomicReference<>();
    private final AtomicReference<String> uri = new AtomicReference<>();
    private HttpServer server;
    private ExecutorService serverThreads;
    private RealtimeMembershipAuthorizationClient client;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        serverThreads = Executors.newCachedThreadPool();
        server.setExecutor(serverThreads);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            method.set(exchange.getRequestMethod());
            uri.set(exchange.getRequestURI().toString());
            authorization.set(exchange.getRequestHeaders().get("Authorization"));
            subject.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            receivedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            try {
                responder.get().respond(exchange);
            } finally {
                exchange.close();
            }
        });
        respond(200, "{\"allowed\":true}");
        server.start();
        client = createClient(Duration.ofMillis(600), 1);
    }

    @AfterEach
    void stop() throws InterruptedException {
        server.stop(0);
        serverThreads.shutdownNow();
        assertThat(serverThreads.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    void sendsOnlyVerifiedIdentityWithSeparateSingleServiceCredential() {
        assertThat(client.isAllowed(identity, island)).isTrue();
        assertThat(calls.get()).isEqualTo(1);
        assertThat(method.get()).isEqualTo("POST");
        assertThat(uri.get()).isEqualTo(PATH);
        assertThat(authorization.get()).containsExactly("Bearer " + SERVICE_TOKEN);
        assertThat(subject.get()).isEqualTo(identity.userId().toString());
        var json = new ObjectMapper().readTree(receivedBody.get());
        assertThat(json.size()).isEqualTo(3);
        assertThat(json.path("sessionId").asText()).isEqualTo(identity.sessionId().toString());
        assertThat(json.path("authGeneration").asLong()).isEqualTo(identity.authGeneration());
        assertThat(json.path("islandId").asText()).isEqualTo(island.toString());
    }

    @Test
    void falseIsAnExplicitDecisionAndIsNotCached() {
        respond(200, "{\"allowed\":false}");
        assertThat(client.isAllowed(identity, island)).isFalse();
        respond(200, "{\"allowed\":true}");
        assertThat(client.isAllowed(identity, island)).isTrue();
        assertThat(calls.get()).isEqualTo(2);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"allowed\":null}", "{\"allowed\":\"true\"}",
            "{\"allowed\":1}", "{\"allowed\":true,\"extra\":0}", "{\"allowed\":true,\"allowed\":false}",
            "{\"allowed\":true}{}", "not-json", "{\"allowed\":"})
    void malformedSuccessIsUnavailableWithoutRetry(String body) {
        respond(200, body);
        assertThatThrownBy(() -> client.isAllowed(identity, island)).isInstanceOf(UpstreamUnavailableException.class);
        assertThat(calls.get()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(ints = {201, 204, 301, 302, 307, 308, 400, 401, 403, 404, 500, 503, 504})
    void non200IncludingRedirectNeverBecomesPermissionOrUserTokenFailure(int status) {
        responder.set(exchange -> {
            exchange.getResponseHeaders().set("Location",
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/redirect");
            send(exchange, status, "{\"allowed\":true}");
        });
        assertThatThrownBy(() -> client.isAllowed(identity, island)).isInstanceOf(UpstreamUnavailableException.class);
        assertThat(calls.get()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "text/plain", "duplicate"})
    void nonJsonOrAmbiguousContentTypeIsUnavailable(String type) {
        responder.set(exchange -> {
            if (!"missing".equals(type)) {
                exchange.getResponseHeaders().add("Content-Type", "duplicate".equals(type) ? "application/json" : type);
            }
            if ("duplicate".equals(type)) {
                exchange.getResponseHeaders().add("Content-Type", "application/json");
            }
            byte[] bytes = "{\"allowed\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        });
        assertThatThrownBy(() -> client.isAllowed(identity, island)).isInstanceOf(UpstreamUnavailableException.class);
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void oversizedResponseCannotHideBehindValidJsonPrefix() {
        respond(200, "{\"allowed\":true}" + " ".repeat(1025));
        assertThatThrownBy(() -> client.isAllowed(identity, island)).isInstanceOf(UpstreamUnavailableException.class);
        assertThat(calls.get()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void fullResponseDeadlineCancelsStallAndReleasesCapacity(boolean headersArrive) throws Exception {
        var bodyStarted = new CountDownLatch(1);
        var releaseBody = new CountDownLatch(1);
        responder.set(exchange -> {
            if (headersArrive) {
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, 0);
                exchange.getResponseBody().write("{\"allowed\":".getBytes(StandardCharsets.UTF_8));
                exchange.getResponseBody().flush();
            }
            bodyStarted.countDown();
            await(releaseBody);
        });
        var caller = Executors.newSingleThreadExecutor();
        try {
            var future = caller.submit(() -> client.isAllowed(identity, island));
            assertThat(bodyStarted.await(3, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> future.get(2, TimeUnit.SECONDS))
                    .hasCauseInstanceOf(UpstreamUnavailableException.class);
            respond(200, "{\"allowed\":true}");
            // 첫 서버 응답은 아직 열려 있다. 시간초과가 다음 호출의 permit까지 붙들면 실패한다.
            assertThat(client.isAllowed(identity, island)).isTrue();
        } finally {
            releaseBody.countDown();
            caller.shutdownNow();
            assertThat(caller.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void frequentSmallChunksCannotExtendWholeResponseDeadline() throws Exception {
        client = createClient(Duration.ofMillis(150), 1);
        var release = new CountDownLatch(1);
        var timer = Executors.newSingleThreadScheduledExecutor();
        var caller = Executors.newSingleThreadExecutor();
        var chunks = new AtomicInteger();
        responder.set(exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write("{\"allowed\":true}".getBytes(StandardCharsets.UTF_8));
            exchange.getResponseBody().flush();
            var trickle = timer.scheduleAtFixedRate(() -> {
                try {
                    exchange.getResponseBody().write(' ');
                    exchange.getResponseBody().flush();
                    chunks.incrementAndGet();
                } catch (IOException closed) {
                    // 취소된 소켓에는 더 쓰지 않는다. 실제 EOF/RST는 별도 raw socket 회귀가 관측한다.
                    release.countDown();
                }
            }, 0, 30, TimeUnit.MILLISECONDS);
            try {
                await(release);
            } finally {
                trickle.cancel(true);
            }
        });
        try {
            var future = caller.submit(() -> client.isAllowed(identity, island));
            assertThatThrownBy(() -> future.get(1, TimeUnit.SECONDS))
                    .hasCauseInstanceOf(UpstreamUnavailableException.class);
            assertThat(chunks.get()).isGreaterThanOrEqualTo(2);
        } finally {
            release.countDown();
            timer.shutdownNow();
            caller.shutdownNow();
            assertThat(timer.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            assertThat(caller.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void bulkheadRejectsSecondCallWithoutSendingAnotherRequest() throws Exception {
        client = createClient(Duration.ofSeconds(3), 1);
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        responder.set(exchange -> {
            entered.countDown();
            await(release);
            send(exchange, 200, "{\"allowed\":true}");
        });
        var caller = Executors.newSingleThreadExecutor();
        try {
            var first = caller.submit(() -> client.isAllowed(identity, island));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> client.isAllowed(identity, island))
                    .isInstanceOf(UpstreamUnavailableException.class);
            assertThat(calls.get()).isEqualTo(1);
            release.countDown();
            assertThat(first.get(2, TimeUnit.SECONDS)).isTrue();
        } finally {
            release.countDown();
            caller.shutdownNow();
            assertThat(caller.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void bodyTimeoutClosesActualSocketInsteadOfOnlyAbandoningCaller() throws Exception {
        try (var listener = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            var peer = Executors.newSingleThreadExecutor();
            try {
                var closed = peer.submit(() -> {
                    try (var socket = listener.accept()) {
                        socket.setSoTimeout(3000);
                        var input = new BufferedInputStream(socket.getInputStream());
                        StringBuilder headers = new StringBuilder();
                        while (!headers.toString().endsWith("\r\n\r\n")) {
                            int next = input.read();
                            if (next < 0 || headers.length() > 16384) {
                                throw new IOException("테스트 요청 헤더를 읽지 못했습니다");
                            }
                            headers.append((char) next);
                        }
                        int length = headers.toString().lines()
                                .filter(line -> line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:"))
                                .mapToInt(line -> Integer.parseInt(line.substring(line.indexOf(':') + 1).trim()))
                                .findFirst().orElseThrow();
                        assertThat(input.readNBytes(length)).hasSize(length);
                        socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                                + "Transfer-Encoding: chunked\r\n\r\nb\r\n{\"allowed\":\r\n")
                                .getBytes(StandardCharsets.US_ASCII));
                        socket.getOutputStream().flush();
                        try {
                            return input.read() == -1;
                        } catch (SocketException reset) {
                            return true;
                        }
                    }
                });
                var properties = settings(Duration.ofMillis(600), 1);
                properties.setBaseUrl("http://127.0.0.1:" + listener.getLocalPort());
                var bounded = new RealtimeMembershipAuthorizationClient(properties);
                assertThatThrownBy(() -> bounded.isAllowed(identity, island))
                        .isInstanceOf(UpstreamUnavailableException.class);
                assertThat(closed.get(2, TimeUnit.SECONDS)).isTrue();
            } finally {
                peer.shutdownNow();
                assertThat(peer.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            }
        }
    }

    private RealtimeMembershipAuthorizationClient createClient(Duration timeout, int maxInFlight) {
        return new RealtimeMembershipAuthorizationClient(settings(timeout, maxInFlight));
    }

    private RealtimeAuthorizationProperties settings(Duration timeout, int maxInFlight) {
        RealtimeAuthorizationProperties properties = new RealtimeAuthorizationProperties();
        properties.setEnabled(true);
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setServiceToken(SERVICE_TOKEN);
        properties.setConnectTimeout(Duration.ofMillis(300));
        properties.setRequestTimeout(timeout);
        properties.setMaxInFlight(maxInFlight);
        return properties;
    }

    private void respond(int status, String body) {
        responder.set(exchange -> send(exchange, status, body));
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, status == 204 ? -1 : bytes.length);
        if (status != 204) {
            exchange.getResponseBody().write(bytes);
        }
    }

    private static void await(CountDownLatch latch) throws IOException {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IOException("테스트 응답 해제 대기 초과");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("테스트 응답 중단");
        }
    }

    @FunctionalInterface
    private interface Responder {
        void respond(HttpExchange exchange) throws IOException;
    }
}

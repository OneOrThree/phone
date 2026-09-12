package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.CompositionCapacityExceededException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamCredentialRejectedException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 TCP HTTP fixture로 전송·시간·취소를 관측한다. 생산 클라이언트 override나 전송 목은 없다. */
class HttpExecutionIntegrationTest {
    private static final ParameterizedTypeReference<Reply> TYPE = new ParameterizedTypeReference<>() { };
    private static final UUID USER = UUID.randomUUID();

    @Test
    void totalBudgetCancelsBlockedResponseAndReturnsConnectionCapacity() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 1)) {
            long started = System.nanoTime();
            assertThatThrownBy(() -> client.exchange(call("/blocked"), context(220), TYPE))
                    .isInstanceOf(UpstreamTimeoutException.class);
            assertThat(elapsed(started)).isLessThan(800);
            assertThat(server.closed.await(1, TimeUnit.SECONDS)).as("실제 TCP 연결이 닫혀야 한다").isTrue();
            assertThat(client.exchange(call("/ok"), context(1000), TYPE).value()).isEqualTo("ok");
        }
    }

    @Test
    void budgetIncludesReadingAnIncompleteResponseBody() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 1)) {
            assertThatThrownBy(() -> client.exchange(call("/slow-body"), context(220), TYPE))
                    .isInstanceOf(UpstreamTimeoutException.class);
            assertThat(server.closed.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(client.exchange(call("/ok"), context(1000), TYPE)).isNotNull();
        }
    }

    @Test
    void budgetCancelsTlsHandshakeBeforeAnyHttpResponse() throws Exception {
        try (ServerSocket listener = new ServerSocket(0)) {
            CountDownLatch closed = new CountDownLatch(1);
            AtomicInteger tlsBytes = new AtomicInteger();
            CompletableFuture<Void> peer = CompletableFuture.runAsync(() -> {
                try (Socket socket = listener.accept()) {
                    socket.setSoTimeout(2000);
                    while (socket.getInputStream().read() != -1) {
                        tlsBytes.incrementAndGet();
                        // TLS ClientHello만 받고 아무 응답도 보내지 않는다.
                    }
                    closed.countDown();
                } catch (java.net.SocketException e) {
                    // IMMEDIATE 취소는 EOF 대신 TCP reset으로 관측될 수도 있다. 둘 다 실제 연결 종료다.
                    closed.countDown();
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            });
            UpstreamProperties settings = settings("https://localhost:" + listener.getLocalPort(), 1, 1);
            try (InternalHttpClient client = new InternalHttpClient(UpstreamTarget.DATA, settings, new ObjectMapper())) {
                long started = System.nanoTime();
                assertThatThrownBy(() -> client.exchange(call("/ok"), context(300), TYPE))
                        .isInstanceOf(UpstreamTimeoutException.class);
                assertThat(elapsed(started)).isLessThan(900);
                assertThat(closed.await(1, TimeUnit.SECONDS))
                        .as("TLS 대기 연결도 취소되어야 한다: 수신 bytes=%s", tlsBytes.get()).isTrue();
                peer.get(1, TimeUnit.SECONDS);
            }
        }
    }

    @Test
    void retryCountAndIdempotencySubjectAndRequestIdArePreservedOnTheWire() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            String requestId = UUID.randomUUID().toString();
            InternalCall command = InternalCall.to(HttpMethod.POST, "/retry").onBehalfOf(USER)
                    .idempotencyKey("stable-key").idempotentCommand().body(Map.of("value", "same")).build();
            assertThat(client.exchange(command, new UpstreamRequestContext(requestId, USER,
                    Deadline.startingNow(Duration.ofSeconds(2))), TYPE).value()).isEqualTo("ok");
            assertThat(server.count("/retry")).isEqualTo(3);
            assertThat(server.requests).hasSize(3).allSatisfy(request -> {
                assertThat(request.get("x-request-id")).isEqualTo(requestId);
                assertThat(request.get("x-user-id")).isEqualTo(USER.toString());
                assertThat(request.get("authorization")).isEqualTo("Bearer server-only-token");
                assertThat(request.get("idempotency-key")).isEqualTo("stable-key");
                assertThat(request.get("body")).isEqualTo("{\"value\":\"same\"}");
            });
        }
    }

    @Test
    void callerHeaderCannotReplaceServerRequestIdAndSubjectMismatchNeverSends() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 1)) {
            MockHttpServletRequest incoming = new MockHttpServletRequest();
            incoming.addHeader("X-Request-Id", "attacker");
            incoming.addHeader("X-User-Id", UUID.randomUUID().toString());
            incoming.setAttribute("requestId", "server-generated-id");
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(incoming));
            try {
                client.exchange(call("/ok"), Deadline.startingNow(Duration.ofSeconds(1)), TYPE);
            } finally {
                RequestContextHolder.resetRequestAttributes();
            }
            assertThat(server.requests.get(0).get("x-request-id")).isEqualTo("server-generated-id");
            assertThat(server.requests.get(0).get("x-user-id")).isEqualTo(USER.toString());
            assertThatThrownBy(() -> InternalCall.to(HttpMethod.GET, "/ok")
                    .header("x-ReQuEsT-Id", "attacker").build()).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> client.exchange(call("/ok"), new UpstreamRequestContext("server", UUID.randomUUID(),
                    Deadline.startingNow(Duration.ofSeconds(1))), TYPE)).isInstanceOf(IllegalArgumentException.class);
            assertThat(server.count("/ok")).isEqualTo(1);
        }
    }

    @Test
    void missingPrimitiveInClaimReceiptIsAContractFailureWithoutRetry() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            var receiptType = new ParameterizedTypeReference<
                    com.oneorthree.business.upstream.data.dto.ClaimIntentAck>() { };
            assertThatThrownBy(() -> client.exchange(call("/missing-completed"), context(1000), receiptType))
                    .isInstanceOf(UpstreamContractMismatchException.class);
            assertThat(server.count("/missing-completed")).isEqualTo(1);
        }
    }

    /**
     * 응답 DTO 를 요구한 호출의 빈 성공 응답은 «상류가 그 일을 했다»가 아니다 — 롤링 배포나 프록시가
     * 돌려준 200/204 빈 본문을 null 로 접으면, 예컨대 ack prepare 의 빈 응답이 HELD tombstone 없이
     * Data ack 를 커밋하게 만든다. 반대로 응답 타입을 요구하지 «않은» 호출(DELETE·PUT 명령)은
     * 204 가 정상이므로 그대로 통과해야 한다 — 한쪽만 막으면 로그아웃의 기기 삭제가 전부 깨진다.
     */
    @Test
    void emptySuccessBodyIsAContractFailureOnlyWhenAResponseTypeWasRequested() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            assertThatThrownBy(() -> client.exchange(call("/no-body"), context(1000), TYPE))
                    .isInstanceOf(UpstreamContractMismatchException.class);
            // 재시도 대상이 아니다 — 종결 판정이라 한 번만 나간다.
            assertThat(server.count("/no-body")).isEqualTo(1);

            client.execute(call("/no-body"), context(1000));
            assertThat(server.count("/no-body")).isEqualTo(2);
        }
    }

    @Test
    void malformedDtoAndCredentialRejectionAreNeverRetried() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            assertThatThrownBy(() -> client.exchange(call("/broken"), context(1000), TYPE))
                    .isInstanceOf(UpstreamContractMismatchException.class);
            assertThatThrownBy(() -> client.exchange(call("/credential"), context(1000), TYPE))
                    .isInstanceOf(UpstreamCredentialRejectedException.class);
            assertThatThrownBy(() -> client.exchange(call("/credential-code"), context(1000), TYPE))
                    .isInstanceOf(UpstreamCredentialRejectedException.class);
            assertThat(server.count("/credential-code")).isEqualTo(1);
            assertThat(server.count("/broken")).isEqualTo(1);
            assertThat(server.count("/credential")).isEqualTo(1);
        }
    }

    @Test
    void retryAfterDoesNotEscapeBudgetAnd429IsReturnedWithoutRetry() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            long started = System.nanoTime();
            assertThatThrownBy(() -> client.exchange(call("/cooldown"), context(300), TYPE))
                    .isInstanceOf(UpstreamTimeoutException.class);
            assertThat(elapsed(started)).isLessThan(800);
            assertThat(server.count("/cooldown")).isEqualTo(1);
            assertThatThrownBy(() -> client.exchange(call("/rate"), context(1000), TYPE))
                    .isInstanceOfSatisfying(UpstreamDomainException.class, e -> {
                        assertThat(e.getStatus()).isEqualTo(429);
                        assertThat(e.getRetryAfterMs()).isEqualTo(2000L);
                    });
            assertThat(server.count("/rate")).isEqualTo(1);
        }
    }

    @ParameterizedTest
    @CsvSource({"503,SERVICE_UNAVAILABLE,false,3600,false", "504,UPSTREAM_TIMEOUT,false,3600,false",
            "503,SERVICE_UNAVAILABLE,true,3600,false", "504,UPSTREAM_TIMEOUT,true,3600,false",
            "503,SERVICE_UNAVAILABLE,true,2,true", "504,UPSTREAM_TIMEOUT,true,2,true"})
    @Timeout(2)
    void excessiveRetryAfterTerminatesWithoutWaitingOrAnotherAttempt(int status, String code, boolean strict,
            int retrySeconds, boolean bounded) throws Exception {
        String path = "/long-cooldown/" + status + "/" + code + "/" + retrySeconds;
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            UpstreamRequestContext request = new UpstreamRequestContext(UUID.randomUUID().toString(), USER,
                    bounded ? Deadline.startingNow(Duration.ofSeconds(10)) : Deadline.unbounded());
            UpstreamRequestContext context = strict ? request.forReads() : request;
            long started = System.nanoTime();
            assertThatThrownBy(() -> client.exchange(call(path), context, TYPE))
                    .isInstanceOf(strict && status == 504 ? UpstreamTimeoutException.class
                            : com.oneorthree.business.common.exception.UpstreamUnavailableException.class);
            assertThat(elapsed(started)).isLessThan(1500);
            assertThat(server.count(path)).isEqualTo(1);
            // 대기 중인 worker/연결이 남지 않아 같은 작은 클라이언트로 바로 다음 호출이 가능하다.
            assertThat(client.exchange(call("/ok"), context(500), TYPE).value()).isEqualTo("ok");
            assertThat(server.count(path)).isEqualTo(1);
        }
    }

    @Test
    @Timeout(2)
    void zeroRetryAfterStillRetriesAndSucceeds() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2)) {
            assertThat(client.exchange(call("/retry-zero"), Deadline.unbounded(), TYPE).value()).isEqualTo("ok");
            assertThat(server.count("/retry-zero")).isEqualTo(2);
        }
    }

    @Test
    void optional503BecomesNullButContractAndDomain403CancelTheSlowSibling() throws Exception {
        for (String path : List.of("/forbidden", "/broken")) {
            try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 3);
                    ScreenComposer composer = new ScreenComposer(3, 3, Duration.ofSeconds(2))) {
                if (path.equals("/forbidden")) {
                    server.waitForBlocked = true;
                }
                long started = System.nanoTime();
                Class<? extends RuntimeException> expected = path.equals("/forbidden")
                        ? UpstreamDomainException.class : UpstreamContractMismatchException.class;
                assertThatThrownBy(() -> composer.compose(context(1500), List.of(
                        fragment("slow", true, client, "/blocked"), fragment("optional", false, client, path))))
                        .isInstanceOf(expected);
                assertThat(elapsed(started)).isLessThan(900);
                if (path.equals("/forbidden")) {
                    assertThat(server.closed.await(1, TimeUnit.SECONDS)).isTrue();
                }
                assertThat(client.exchange(call("/ok"), context(1000), TYPE)).isNotNull();
            }
        }
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 2);
                ScreenComposer composer = new ScreenComposer(2, 2, Duration.ofSeconds(2))) {
            Map<String, Object> result = composer.compose(context(1500), List.of(
                    fragment("main", true, client, "/ok"), fragment("extra", false, client, "/unavailable")));
            assertThat(result.get("main")).isEqualTo(new Reply("ok"));
            assertThat(result).containsEntry("extra", null);
        }
    }

    @ParameterizedTest
    @CsvSource({"500,INTERNAL_ERROR", "502,UPSTREAM_CONTRACT_ERROR", "502,UPSTREAM_AUTH_FAILED",
            "500,UNREGISTERED_FAILURE", "502,UNREGISTERED_FAILURE", "500,SERVICE_UNAVAILABLE",
            "503,UPSTREAM_TIMEOUT", "504,SERVICE_UNAVAILABLE"})
    void explicitPermanentServerErrorIsNeverRetriedOrHiddenByOptionalFallback(int status, String code)
            throws Exception {
        String path = "/structured/" + status + "/" + code;
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 3);
                ScreenComposer composer = new ScreenComposer(2, 2, Duration.ofSeconds(2))) {
            server.waitForBlocked = true;
            assertThatThrownBy(() -> composer.compose(context(1500), List.of(
                    fragment("slow", true, client, "/blocked"), fragment("optional", false, client, path))))
                    .isInstanceOfSatisfying(UpstreamDomainException.class, error -> {
                        assertThat(error.getStatus()).isEqualTo(status);
                        assertThat(error.getCode()).isEqualTo(code);
                    });
            assertThat(server.count(path)).as("명시적 영구 오류는 최초 응답에서 종결한다").isEqualTo(1);
            assertThat(server.closed.await(1, TimeUnit.SECONDS))
                    .as("화면 실패 시 느린 필수 조각의 실제 TCP도 닫는다").isTrue();
        }
    }

    @Test
    void explicitTransientServerErrorKeepsBoundedRetryAndOptionalFallback() throws Exception {
        String path = "/structured/503/SERVICE_UNAVAILABLE";
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 2);
                ScreenComposer composer = new ScreenComposer(2, 2, Duration.ofSeconds(2))) {
            Map<String, Object> result = composer.compose(context(1500), List.of(
                    fragment("main", true, client, "/ok"), fragment("optional", false, client, path)));
            assertThat(result).containsEntry("main", new Reply("ok")).containsEntry("optional", null);
            assertThat(server.count(path)).isEqualTo(3);
        }
    }

    @ParameterizedTest
    @CsvSource({"504,UPSTREAM_TIMEOUT,true", "503,SERVICE_UNAVAILABLE,false", "503,UPSTREAM_UNAVAILABLE,false"})
    void exhaustedRetryPreservesTheTransientFailureKind(int status, String code, boolean timeout)
            throws Exception {
        String path = "/structured/" + status + "/" + code;
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 2, 2)) {
            assertThatThrownBy(() -> client.exchange(call(path), context(1500).forReads(), TYPE))
                    .isInstanceOf(timeout ? UpstreamTimeoutException.class
                            : com.oneorthree.business.common.exception.UpstreamUnavailableException.class);
            assertThat(server.count(path)).isEqualTo(2);
        }
    }

    @Test
    void legacy504KeepsItsOriginalUnavailableClassification() throws Exception {
        String path = "/structured/504/UPSTREAM_TIMEOUT";
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 2, 2)) {
            assertThatThrownBy(() -> client.exchange(call(path),
                    Deadline.startingNow(Duration.ofSeconds(2)), TYPE))
                    .isInstanceOf(com.oneorthree.business.common.exception.UpstreamUnavailableException.class);
            assertThat(server.count(path)).isEqualTo(2);
        }
    }

    @Test
    void optionalCannotHideWholeDeadlineAndQueuedWorkNeverMakesHttpRequest() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 1);
                ScreenComposer composer = new ScreenComposer(1, 2, Duration.ofMillis(200))) {
            assertThatThrownBy(() -> composer.compose(context(200), List.of(
                    fragment("optional", false, client, "/blocked"), fragment("queued", false, client, "/ok"))))
                    .isInstanceOf(UpstreamTimeoutException.class);
            assertThat(server.closed.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(server.count("/ok")).isZero();
            // 취소한 queued wrapper가 자리를 계속 차지하면 이 작은 풀의 다음 화면이 실패한다.
            assertThat(composer.compose(context(1000), List.of(fragment("next", true, client, "/ok"))))
                    .containsEntry("next", new Reply("ok"));
        }
    }

    @Test
    void boundedExecutorRejectsExcessWorkAndCancelsStartedRequests() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 1);
                ScreenComposer composer = new ScreenComposer(1, 1, Duration.ofSeconds(2))) {
            List<ReadFragment<?>> fragments = new ArrayList<>();
            for (int i = 0; i < 20; i++) {
                fragments.add(fragment("part" + i, true, client, "/blocked"));
            }
            assertThatThrownBy(() -> composer.compose(context(1500), fragments))
                    .isInstanceOf(CompositionCapacityExceededException.class);
            assertThat(server.count("/blocked")).isLessThanOrEqualTo(1);
            assertThat(composer.compose(context(1000), List.of(fragment("next", true, client, "/ok"))))
                    .containsEntry("next", new Reply("ok"));
        }
    }

    @Test
    void optionalReadTimeoutIsNullOnlyWhileWholeBudgetRemains() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = new InternalHttpClient(UpstreamTarget.DATA,
                new UpstreamProperties(server.base(), "server-only-token", Duration.ofMillis(200),
                        Duration.ofMillis(60), 10, Duration.ofSeconds(1), 1, Duration.ZERO, 2, 2), new ObjectMapper());
                ScreenComposer composer = new ScreenComposer(2, 2, Duration.ofSeconds(1))) {
            Map<String, Object> result = composer.compose(context(1000), List.of(
                    fragment("main", true, client, "/ok"), fragment("extra", false, client, "/blocked")));
            assertThat(result).containsEntry("main", new Reply("ok")).containsEntry("extra", null);
            assertThat(server.closed.await(1, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void httpWorkerQueueUsesTheSameDeadlineAndParentCancellationNeverRetries() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 3, 1)) {
            UpstreamRequestContext firstContext = context(2000);
            CompletableFuture<Void> first = CompletableFuture.runAsync(() ->
                    assertThatThrownBy(() -> client.exchange(call("/blocked"), firstContext, TYPE))
                            .isInstanceOf(UpstreamTimeoutException.class));
            assertThat(server.blocked.await(1, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> client.exchange(call("/ok"), context(120), TYPE))
                    .isInstanceOf(UpstreamTimeoutException.class);
            assertThat(server.count("/ok")).isZero();
            firstContext.cancel();
            first.get(1, TimeUnit.SECONDS);
            assertThat(server.closed.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(server.count("/blocked")).isEqualTo(1);
            assertThat(client.exchange(call("/ok"), context(1000), TYPE)).isNotNull();
        }
    }

    @Test
    void initialSixteenWorkerSixtyFourQueueLimitRejectsTheEightyFirstBlockedFragment() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 16);
                ScreenComposer composer = new ScreenComposer(16, 64, Duration.ofSeconds(3))) {
            List<ReadFragment<?>> fragments = new ArrayList<>();
            for (int i = 0; i < 81; i++) {
                fragments.add(fragment("part" + i, true, client, "/blocked"));
            }
            assertThatThrownBy(() -> composer.compose(context(2000), fragments))
                    .isInstanceOf(CompositionCapacityExceededException.class);
            assertThat(server.count("/blocked")).isLessThanOrEqualTo(16);
            assertThat(composer.compose(context(1000), List.of(fragment("next", true, client, "/ok"))))
                    .containsEntry("next", new Reply("ok"));
        }
    }

    @Test
    void compositionPropagatesContextThroughExistingFacadeAndRejectsParallelWrites() throws Exception {
        try (Fixture server = new Fixture(); InternalHttpClient client = client(server, 1, 2);
                ScreenComposer composer = new ScreenComposer(2, 2, Duration.ofSeconds(1))) {
            UpstreamRequestContext context = composer.start("same-context", USER);
            ReadFragment<Reply> legacy = new ReadFragment<>("legacy", true, TYPE, Set.of(),
                    ctx -> client.exchange(call("/ok"), ctx.deadline(), TYPE));
            composer.compose(context, List.of(legacy));
            assertThat(server.requests.get(0)).containsEntry("x-request-id", "same-context")
                    .containsEntry("x-user-id", USER.toString());
            ReadFragment<Reply> write = new ReadFragment<>("write", true, TYPE, Set.of(),
                    ctx -> client.exchange(InternalCall.to(HttpMethod.POST, "/ok").onBehalfOf(USER).build(),
                            ctx.deadline(), TYPE));
            assertThatThrownBy(() -> composer.compose(context(1000), List.of(write)))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(server.count("/ok")).isEqualTo(1);
            assertThatThrownBy(() -> composer.compose(context(0), List.of(legacy)))
                    .isInstanceOf(UpstreamTimeoutException.class);
        }
    }

    @ParameterizedTest
    @CsvSource({"401,slow", "403,slow", "404,slow", "429,slow", "403,closed", "403,drip"})
    void partialClientErrorIsTerminalEvenWhenOptionalAllowsTimeout(int status, String mode) throws Exception {
        String path = "/partial/" + status + "/" + mode;
        try (Fixture server = new Fixture(); InternalHttpClient client = new InternalHttpClient(UpstreamTarget.DATA,
                new UpstreamProperties(server.base(), "server-only-token", Duration.ofMillis(150),
                        Duration.ofMillis(100), 10, Duration.ofSeconds(1), 3, Duration.ZERO, 2, 2), new ObjectMapper());
                ScreenComposer composer = new ScreenComposer(2, 2, Duration.ofSeconds(2))) {
            assertThatThrownBy(() -> composer.compose(context(1500), List.of(
                    fragment("main", true, client, "/ok"), fragment("denied", false, client, path))))
                    .isInstanceOf(UpstreamContractMismatchException.class);
            assertThat(server.count(path)).as("4xx를 받았으므로 재시도하지 않는다").isEqualTo(1);
            if (!mode.equals("closed")) {
                assertThat(server.closed.await(1, TimeUnit.SECONDS)).as("부분 오류 연결도 실제로 닫는다").isTrue();
            }
            assertThat(client.exchange(call("/ok"), context(1000), TYPE).value()).isEqualTo("ok");
        }
    }

    private static long elapsed(long started) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    }

    private static InternalCall call(String path) {
        return InternalCall.to(HttpMethod.GET, path).onBehalfOf(USER).build();
    }

    private static UpstreamRequestContext context(long millis) {
        return new UpstreamRequestContext(UUID.randomUUID().toString(), USER,
                Deadline.startingNow(Duration.ofMillis(millis)));
    }

    private static ReadFragment<Reply> fragment(String name, boolean required, InternalHttpClient client, String path) {
        return new ReadFragment<>(name, required, TYPE, required ? Set.of()
                : Set.of(ReadFragment.TransientFailure.UNAVAILABLE, ReadFragment.TransientFailure.TIMEOUT),
                ctx -> client.exchange(call(path), ctx, TYPE));
    }

    private static UpstreamProperties settings(String base, int attempts, int capacity) {
        return new UpstreamProperties(base, "server-only-token", Duration.ofSeconds(2), Duration.ofSeconds(2),
                10, Duration.ofSeconds(1), attempts, Duration.ofMillis(10), capacity, 2);
    }

    private static InternalHttpClient client(Fixture fixture, int attempts, int capacity) {
        return new InternalHttpClient(UpstreamTarget.DATA, settings(fixture.base(), attempts, capacity), new ObjectMapper());
    }

    record Reply(String value) { }

    private static final class Fixture implements AutoCloseable {
        private final ServerSocket listener = new ServerSocket(0);
        private final ExecutorService executor = Executors.newFixedThreadPool(8);
        private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
        private final Map<String, AtomicInteger> counts = new ConcurrentHashMap<>();
        private final List<Map<String, String>> requests = new java.util.concurrent.CopyOnWriteArrayList<>();
        private final CountDownLatch blocked = new CountDownLatch(1);
        private final CountDownLatch closed = new CountDownLatch(1);
        private volatile boolean waitForBlocked;

        Fixture() throws IOException {
            executor.submit(() -> {
                while (!listener.isClosed()) {
                    try {
                        Socket socket = listener.accept();
                        sockets.add(socket);
                        executor.submit(() -> serve(socket));
                    } catch (IOException e) {
                        if (!listener.isClosed()) {
                            throw new IllegalStateException(e);
                        }
                    }
                }
            });
        }

        String base() {
            return "http://localhost:" + listener.getLocalPort();
        }

        int count(String path) {
            AtomicInteger value = counts.get(path);
            return value == null ? 0 : value.get();
        }

        private void serve(Socket socket) {
            try (socket; BufferedReader reader = new BufferedReader(new InputStreamReader(
                    socket.getInputStream(), StandardCharsets.UTF_8))) {
                socket.setSoTimeout(5000);
                String first = reader.readLine();
                if (first == null) {
                    return;
                }
                String path = first.split(" ")[1];
                Map<String, String> request = new ConcurrentHashMap<>();
                String header;
                while ((header = reader.readLine()) != null && !header.isEmpty()) {
                    int colon = header.indexOf(':');
                    request.put(header.substring(0, colon).toLowerCase(java.util.Locale.ROOT),
                            header.substring(colon + 1).trim());
                }
                int length = Integer.parseInt(request.getOrDefault("content-length", "0"));
                char[] body = new char[length];
                int read = 0;
                while (read < length) {
                    int next = reader.read(body, read, length - read);
                    if (next == -1) {
                        return;
                    }
                    read += next;
                }
                request.put("body", new String(body));
                requests.add(request);
                counts.computeIfAbsent(path, key -> new AtomicInteger()).incrementAndGet();
                if (path.equals("/blocked") || path.equals("/slow-body")) {
                    if (path.equals("/slow-body")) {
                        write(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{");
                    }
                    blocked.countDown();
                    if (reader.read() == -1) {
                        closed.countDown();
                    }
                    return;
                }
                if (path.startsWith("/partial/")) {
                    String[] parts = path.split("/");
                    write(socket, "HTTP/1.1 " + parts[2] + " Test\r\nContent-Type: application/json\r\n"
                            + "Content-Length: 1000\r\n\r\n{");
                    if (parts[3].equals("closed")) {
                        return;
                    }
                    if (parts[3].equals("drip")) {
                        // read timeout 이내에 bytes를 계속 주어 attempt Future의 시간 상한을 검증한다.
                        for (int i = 0; i < 100; i++) {
                            Thread.sleep(20);
                            write(socket, " ");
                        }
                    }
                    if (reader.read() == -1) {
                        closed.countDown();
                    }
                    return;
                }
                if (path.equals("/no-body")) {
                    // 응답 타입을 요구한 호출에 «성공 + 빈 본문» — 롤링 배포·프록시가 돌려주는 모양이다.
                    write(socket, "HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    return;
                }
                if (path.startsWith("/structured/") || path.startsWith("/long-cooldown/")) {
                    if (waitForBlocked) {
                        blocked.await(1, TimeUnit.SECONDS);
                    }
                    String[] parts = path.split("/");
                    String json = "{\"code\":\"" + parts[3] + "\",\"message\":\"synthetic\"}";
                    String retry = path.startsWith("/long-cooldown/") ? "Retry-After: " + parts[4] + "\r\n" : "";
                    write(socket, "HTTP/1.1 " + parts[2] + " Test\r\nContent-Type: application/json\r\n"
                            + retry + "Connection: close\r\nContent-Length: "
                            + json.getBytes(StandardCharsets.UTF_8).length + "\r\n\r\n" + json);
                    return;
                }
                if (waitForBlocked && path.equals("/forbidden")) {
                    blocked.await(1, TimeUnit.SECONDS);
                }
                int status = switch (path) {
                    case "/forbidden", "/credential" -> 403;
                    case "/credential-code" -> 401;
                    case "/rate" -> 429;
                    case "/unavailable", "/cooldown" -> 503;
                    case "/retry" -> count(path) < 3 ? 503 : 200;
                    case "/retry-zero" -> count(path) < 2 ? 503 : 200;
                    default -> 200;
                };
                String json = switch (path) {
                    case "/broken" -> "this-is-not-json";
                    case "/credential-code" -> "{\"code\":\"INVALID_SERVICE_TOKEN\"}";
                    case "/missing-completed" -> "{\"commandId\":\"" + USER
                            + "\",\"eventId\":\"e\",\"version\":1}";
                    case "/forbidden" -> "{\"code\":\"FORBIDDEN\",\"message\":\"denied\"}";
                    case "/credential" -> "no credential";
                    case "/rate" -> "{\"code\":\"RATE_LIMITED\",\"message\":\"later\"}";
                    default -> "{\"value\":\"ok\"}";
                };
                String retry = switch (path) {
                    case "/cooldown", "/rate" -> "Retry-After: 2\r\n";
                    case "/retry-zero" -> "Retry-After: 0\r\n";
                    default -> "";
                };
                write(socket, "HTTP/1.1 " + status + " Test\r\nContent-Type: application/json\r\nConnection: close\r\n"
                        + retry + "Content-Length: " + json.getBytes(StandardCharsets.UTF_8).length + "\r\n\r\n" + json);
            } catch (IOException e) {
                closed.countDown();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                sockets.remove(socket);
            }
        }

        private static void write(Socket socket, String response) throws IOException {
            socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().flush();
        }

        @Override
        public void close() throws IOException {
            listener.close();
            for (Socket socket : sockets) {
                socket.close();
            }
            executor.shutdownNow();
        }
    }
}

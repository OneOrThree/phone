package com.oneorthree.business.common.http;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class RequestLogPropagationTest {
    private static final ParameterizedTypeReference<Reply> TYPE = new ParameterizedTypeReference<>() { };
    private static final org.slf4j.Logger LOG = LoggerFactory.getLogger(RequestLogPropagationTest.class);

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void publicRequestCrossesBothWorkerPoolsAndWireWithOneId() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/probe", exchange -> {
            String id = exchange.getRequestHeaders().getFirst("X-Request-Id");
            byte[] body = ("{\"value\":\"" + id + "\"}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        Snapshots snapshots = new Snapshots();
        Logger root = (Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        snapshots.start();
        root.addAppender(snapshots);
        UpstreamProperties properties = new UpstreamProperties(
                "http://127.0.0.1:" + server.getAddress().getPort(), "synthetic-token",
                Duration.ofSeconds(1), Duration.ofSeconds(1), 10, Duration.ofSeconds(1),
                1, Duration.ofMillis(10), 1, 2);
        try (InternalHttpClient client = new InternalHttpClient(UpstreamTarget.DATA, properties, new ObjectMapper());
                ScreenComposer composer = new ScreenComposer(1, 2, Duration.ofSeconds(5))) {
            MDC.put("request_id", "outer");
            MDC.put("dd.trace_id", "caller-tracer");
            MDC.put("private", "must-not-copy");
            String previous = null;
            // 두 요청이 같은 풀을 재사용해도 각각의 새 ID를 기록해야 한다.
            for (int i = 0; i < 2; i++) {
                snapshots.values.clear();
                MockHttpServletRequest incoming = new MockHttpServletRequest("GET", "/health");
                incoming.addHeader("X-Request-Id", "untrusted");
                MockHttpServletResponse response = new MockHttpServletResponse();
                new RequestEnvelopeFilter(mock(ApiResponses.class)).doFilter(incoming, response, (request, result) -> {
                    String id = (String) request.getAttribute(RequestEnvelopeFilter.REQUEST_ID);
                    assertThat(MDC.get("request_id")).isEqualTo(id);
                    UpstreamRequestContext context = composer.start(id, null);
                    Map<String, Object> composed = composer.compose(context, List.of(
                            new ReadFragment<>("probe", true, TYPE, Set.of(), current -> {
                                LOG.info("fragment_probe");
                                return client.exchange(InternalCall.to(HttpMethod.GET, "/probe").build(), current, TYPE);
                            })));
                    assertThat(((Reply) composed.get("probe")).value()).isEqualTo(id);
                });
                String id = response.getHeader("X-Request-Id");
                assertThat(id).isNotEqualTo("untrusted").isNotEqualTo(previous);
                assertThat(snapshots.values).hasSize(3).allSatisfy(row -> assertThat(row.id()).isEqualTo(id));
                assertThat(snapshots.values).filteredOn(row -> !row.message().startsWith("business_request"))
                        .hasSize(2).allSatisfy(row -> {
                            assertThat(row.thread()).isNotEqualTo(Thread.currentThread().getName());
                            assertThat(row.traceId()).isNull();
                            assertThat(row.privateValue()).isNull();
                        });
                assertThat(snapshots.values.stream().map(Snapshot::thread).distinct()).hasSize(3);
                assertThat(MDC.get("request_id")).isEqualTo("outer");
                assertThat(MDC.get("dd.trace_id")).isEqualTo("caller-tracer");
                previous = id;
            }
        } finally {
            root.detachAppender(snapshots);
            snapshots.stop();
            server.stop(0);
        }
    }

    @Test
    void nestedScopesAndFailuresRestoreOnlyOwnedKeyOnReusedWorker() throws Exception {
        var worker = Executors.newSingleThreadExecutor();
        try {
            worker.submit(() -> {
                MDC.put("request_id", "worker-before");
                MDC.put("dd.span_id", "worker-tracer");
                UpstreamRequestContext outer = context("outer");
                assertThatThrownBy(() -> outer.within(() -> {
                    assertThat(UpstreamRequestContext.current()).isSameAs(outer);
                    assertThat(MDC.get("request_id")).isEqualTo("outer");
                    context("inner").within(() -> {
                        assertThat(MDC.get("request_id")).isEqualTo("inner");
                        MDC.put("foreign", "updated");
                        return null;
                    });
                    assertThat(MDC.get("request_id")).isEqualTo("outer");
                    assertThat(UpstreamRequestContext.current()).isSameAs(outer);
                    throw new IllegalStateException("synthetic");
                })).isInstanceOf(IllegalStateException.class);
                assertThat(MDC.get("request_id")).isEqualTo("worker-before");
                assertThat(MDC.get("dd.span_id")).isEqualTo("worker-tracer");
                assertThat(MDC.get("foreign")).isEqualTo("updated");
                assertThat(UpstreamRequestContext.current()).isNull();
                MDC.remove("request_id");
            }).get(5, TimeUnit.SECONDS);
            worker.submit(() -> {
                context("next").within(() -> {
                    assertThat(MDC.get("request_id")).isEqualTo("next");
                    return null;
                });
                assertThat(MDC.get("request_id")).isNull();
                assertThat(MDC.get("dd.span_id")).isEqualTo("worker-tracer");
                MDC.clear();
            }).get(5, TimeUnit.SECONDS);
        } finally {
            worker.shutdownNow();
        }
    }

    @Test
    void filterRestoresOuterContextAfterUnhandledFailure() {
        MDC.put("request_id", "outer");
        MDC.put("dd.trace_id", "tracer");
        var response = new MockHttpServletResponse();
        assertThatThrownBy(() -> new RequestEnvelopeFilter(mock(ApiResponses.class)).doFilter(
                new MockHttpServletRequest("GET", "/health"), response, (request, result) -> {
                    assertThat(MDC.get("request_id")).isEqualTo(response.getHeader("X-Request-Id"));
                    throw new ServletException("synthetic");
                })).isInstanceOf(ServletException.class);
        assertThat(MDC.get("request_id")).isEqualTo("outer");
        assertThat(MDC.get("dd.trace_id")).isEqualTo("tracer");
    }

    @ParameterizedTest
    @ValueSource(strings = {"X-Request-Id", "x-request-id", "X-REQUEST-ID"})
    void declaredHeadersCannotReplaceRequestId(String name) {
        assertThatThrownBy(() -> InternalCall.to(HttpMethod.GET, "/probe").header(name, "untrusted").build())
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void failedSendLeavesNoRequestIdOnTheHttpWorker() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger hits = new AtomicInteger();
        // 응답 없이 연결을 끊어 실제 전송 실패를 만든다.
        server.createContext("/drop", exchange -> {
            hits.incrementAndGet();
            exchange.close();
        });
        server.start();
        try (InternalHttpClient client = singleWorkerClient(server)) {
            UpstreamRequestContext failing = context("failed-request");
            assertThatThrownBy(() -> client.exchange(InternalCall.to(HttpMethod.GET, "/drop").build(), failing, TYPE))
                    .isInstanceOf(UpstreamUnavailableException.class);
            assertThat(hits.get()).isEqualTo(1);
            // 풀은 worker 1개뿐이라 같은 스레드가 다음 작업을 실행한다.
            Map<String, String> next = workerOf(client).submit(() -> Map.of("thread", Thread.currentThread().getName(),
                    "id", String.valueOf(MDC.get("request_id")))).get(5, TimeUnit.SECONDS);
            assertThat(next.get("thread")).startsWith("internal-http-");
            assertThat(next.get("id")).isEqualTo("null");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void jobCancelledWhileQueuedIsRemovedAndNeverInstallsItsRequestId() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger queuedHits = new AtomicInteger();
        server.createContext("/blocked", exchange -> {
            entered.countDown();
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            byte[] body = "{\"value\":\"ok\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.createContext("/queued", exchange -> {
            queuedHits.incrementAndGet();
            exchange.close();
        });
        server.start();
        try (InternalHttpClient client = singleWorkerClient(server)) {
            ThreadPoolExecutor pool = workerOf(client);
            // worker 1개를 /blocked 로 점유한 것을 래치로 확인한다.
            CompletableFuture<Reply> running = CompletableFuture.supplyAsync(() -> client.exchange(
                    InternalCall.to(HttpMethod.GET, "/blocked").build(), context("running-request"), TYPE));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            UpstreamRequestContext queued = new UpstreamRequestContext("queued-request", null,
                    Deadline.startingNow(Duration.ofMillis(200)));
            assertThatThrownBy(() -> client.exchange(InternalCall.to(HttpMethod.GET, "/queued").build(), queued, TYPE))
                    .isInstanceOf(UpstreamTimeoutException.class);
            // 큐에서 대기하다 취소된 작업은 큐에서도 빠져 worker 가 집어 들 수 없다.
            assertThat(pool.getQueue()).isEmpty();
            release.countDown();
            assertThat(running.get(5, TimeUnit.SECONDS)).isEqualTo(new Reply("ok"));
            Map<String, String> next = pool.submit(() -> Map.of("id", String.valueOf(MDC.get("request_id"))))
                    .get(5, TimeUnit.SECONDS);
            assertThat(next.get("id")).isEqualTo("null");
            assertThat(queuedHits.get()).isZero();
        } finally {
            release.countDown();
            server.stop(0);
        }
    }

    private static InternalHttpClient singleWorkerClient(HttpServer server) {
        return new InternalHttpClient(UpstreamTarget.DATA, new UpstreamProperties(
                "http://127.0.0.1:" + server.getAddress().getPort(), "synthetic-token",
                Duration.ofSeconds(1), Duration.ofSeconds(5), 10, Duration.ofSeconds(1),
                1, Duration.ZERO, 1, 1), new ObjectMapper());
    }

    /** 실제 풀을 그대로 꺼내 같은 worker 스레드의 MDC 를 관찰한다. */
    private static ThreadPoolExecutor workerOf(InternalHttpClient client) throws ReflectiveOperationException {
        var field = InternalHttpClient.class.getDeclaredField("workers");
        field.setAccessible(true);
        return (ThreadPoolExecutor) field.get(client);
    }

    private static UpstreamRequestContext context(String id) {
        return new UpstreamRequestContext(id, null, Deadline.unbounded());
    }

    record Reply(String value) {
        Reply {
            LOG.info("http_reply_probe");
        }
    }

    record Snapshot(String message, String id, String thread, String traceId, String privateValue) { }

    private static class Snapshots extends AppenderBase<ILoggingEvent> {
        private final List<Snapshot> values = new CopyOnWriteArrayList<>();

        @Override
        protected void append(ILoggingEvent event) {
            if (event.getLoggerName().equals(RequestLogPropagationTest.class.getName())
                    || event.getLoggerName().equals(RequestEnvelopeFilter.class.getName())) {
                Map<String, String> mdc = event.getMDCPropertyMap();
                values.add(new Snapshot(event.getFormattedMessage(), mdc.get("request_id"), event.getThreadName(),
                        mdc.get("dd.trace_id"), mdc.get("private")));
            }
        }
    }
}

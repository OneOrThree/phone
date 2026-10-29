package com.oneorthree.business.common.http;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.MDC;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 공통 내부 HTTP client 의 원인 문맥 전파 (GROMO-2582). */
class InternalHttpClientOriginHeaderTest {

    private static final ParameterizedTypeReference<Map<String, Object>> TYPE = new ParameterizedTypeReference<>() { };

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void originInTheCallerScopeReachesTheWireAndMalformedValuesAreDropped() throws Exception {
        List<Map<String, String>> seen = new CopyOnWriteArrayList<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/probe", exchange -> {
            var headers = exchange.getRequestHeaders();
            seen.add(Map.of(
                    "request", String.valueOf(headers.getFirst("X-Request-Id")),
                    "origin", String.valueOf(headers.getFirst("X-Origin-Request-Id")),
                    "trace", String.valueOf(headers.getFirst("X-Origin-Trace-Id")),
                    "version", String.valueOf(headers.getFirst("X-Trace-Context-Version"))));
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        UpstreamProperties properties = new UpstreamProperties(
                "http://127.0.0.1:" + server.getAddress().getPort(), "synthetic-token",
                Duration.ofSeconds(1), Duration.ofSeconds(1), 10, Duration.ofSeconds(1),
                1, Duration.ofMillis(10), 1, 2);
        try (InternalHttpClient client = new InternalHttpClient(UpstreamTarget.DATA, properties, new ObjectMapper())) {
            InternalCall call = InternalCall.to(HttpMethod.GET, "/probe").build();
            MDC.put("origin_request_id", "req-first");
            MDC.put("origin_trace_id", "6720d0ec00000000a1b2c3d4e5f60718");
            client.exchange(call, context("hop-2"), TYPE);
            MDC.put("origin_request_id", "bad id\r\nforged: 1");
            MDC.remove("origin_trace_id");
            client.exchange(call, context("hop-2"), TYPE);
            MDC.clear();
            client.exchange(call, context("hop-2"), TYPE);
        } finally {
            server.stop(0);
        }

        assertThat(seen).hasSize(3);
        assertThat(seen.get(0)).containsEntry("request", "hop-2").containsEntry("origin", "req-first")
                .containsEntry("trace", "6720d0ec00000000a1b2c3d4e5f60718").containsEntry("version", "1");
        assertThat(seen.get(1)).as("형식이 틀린 값은 헤더로 나가지 않는다").containsEntry("origin", "null")
                .containsEntry("version", "null");
        assertThat(seen.get(2)).as("문맥이 없으면 달지 않는다 — 원인은 X-Request-Id 로 간다")
                .containsEntry("origin", "null").containsEntry("trace", "null").containsEntry("version", "null");
    }

    @ParameterizedTest
    @ValueSource(strings = {"X-Origin-Request-Id", "x-origin-trace-id", "X-Trace-Context-Version"})
    void declaredHeadersCannotForgeTheOriginCarrier(String name) {
        assertThatThrownBy(() -> InternalCall.to(HttpMethod.GET, "/probe").header(name, "forged").build())
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static UpstreamRequestContext context(String id) {
        return new UpstreamRequestContext(id, null, Deadline.unbounded());
    }
}

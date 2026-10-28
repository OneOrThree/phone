package com.oneorthree.realtime.sea.client;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
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

/** Data {@code sea-state} 응답 계약 — 불완전한 세션은 NPE 가 아니라 상류 불량({@code UpstreamUnavailableException})으로 접는다. */
class SeaStateClientTest {

    private static final UUID USER = UUID.fromString("019f16a0-0000-7000-8000-000000000002");
    private static final String SESSION_PREFIX =
            "{\"sessionId\":\"019f16a0-0000-7000-8000-000000000003\","
                    + "\"destinationIslandId\":\"019f16a0-0000-7000-8000-000000000001\","
                    + "\"startedAt\":\"2026-10-17T00:00:00Z\"";

    private HttpServer server;
    private SeaStateClient client;
    private final AtomicReference<String> body = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/users", exchange -> {
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        client = new SeaStateClient("http://127.0.0.1:" + server.getAddress().getPort(), "svc-token", 1000);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    @DisplayName("세션의 숫자·시각 필드가 모두 있으면 그대로 돌려준다")
    void completeSessionPasses() {
        body.set("{\"remark\":null,\"session\":" + SESSION_PREFIX
                + ",\"sailingMinutes\":25,\"activeSeconds\":60,\"serverNow\":\"2026-10-17T00:01:00Z\"}}");

        assertThat(client.fetch(USER).session().sailingMinutes()).isEqualTo(25);
    }

    @Test
    @DisplayName("세션의 sailingMinutes·activeSeconds·serverNow 중 하나라도 null 이면 불완전로 접는다")
    void numericFieldNullFoldsAsIncomplete() {
        String[] bodies = {
            SESSION_PREFIX + ",\"activeSeconds\":60,\"serverNow\":\"2026-10-17T00:01:00Z\"}",
            SESSION_PREFIX + ",\"sailingMinutes\":25,\"serverNow\":\"2026-10-17T00:01:00Z\"}",
            SESSION_PREFIX + ",\"sailingMinutes\":25,\"activeSeconds\":60}",
        };
        for (String session : bodies) {
            body.set("{\"remark\":null,\"session\":" + session + "}");

            assertThatThrownBy(() -> client.fetch(USER)).isInstanceOf(UpstreamUnavailableException.class);
        }
    }

    @Test
    @DisplayName("[2330] 모르는 키(futureField)가 섞여도 역직렬화가 성공하고 name·catColor 가 읽힌다")
    void unknownKeysAreIgnoredAndProfileIsRead() {
        body.set("{\"remark\":null,\"remarkChangedAt\":null,\"session\":null,"
                + "\"name\":\"x\",\"catColor\":\"black\",\"futureField\":1}");

        SeaStateClient.SeaState state = client.fetch(USER);

        assertThat(state.name()).isEqualTo("x");
        assertThat(state.catColor()).isEqualTo("black");
    }

    @Test
    @DisplayName("[2330] 옛 Data 응답(name·catColor 키 없음)은 null 로 들어온다")
    void missingProfileKeysAreNull() {
        body.set("{\"remark\":null,\"remarkChangedAt\":null,\"session\":null}");

        SeaStateClient.SeaState state = client.fetch(USER);

        assertThat(state.name()).isNull();
        assertThat(state.catColor()).isNull();
    }
}

package com.oneorthree.notification;

import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClientResponseException;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FcmTransportTest {
    private HttpServer server;
    private SimpleMeterRegistry meters;
    private AtomicInteger status;
    private AtomicReference<String> response;
    private AtomicReference<String> request;

    @BeforeEach
    void start() throws IOException {
        status = new AtomicInteger(200);
        response = new AtomicReference<>("{}");
        request = new AtomicReference<>();
        meters = new SimpleMeterRegistry();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/projects/test-project/messages:send", exchange -> {
            request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = response.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), body.length);
            try (var output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
        meters.close();
    }

    @Test
    void 실제요청이성공과오류를분류하고프로젝트불일치를센다() {
        FcmTransport transport = transport();
        assertThat(send(transport)).isEqualTo(PushTransport.Result.SENT);
        assertThat(request.get()).contains("device-token");

        status.set(403);
        response.set(fcmError("SENDER_ID_MISMATCH"));
        assertThat(send(transport)).isEqualTo(PushTransport.Result.UNREGISTERED);
        assertThat(meters.counter("notification.fcm.sender_mismatch").count()).isEqualTo(1);

        status.set(404);
        response.set(fcmError("UNREGISTERED"));
        assertThat(send(transport)).isEqualTo(PushTransport.Result.UNREGISTERED);

        status.set(503);
        response.set(fcmError("UNAVAILABLE"));
        assertThat(send(transport)).isEqualTo(PushTransport.Result.RETRY);
        assertThat(meters.counter("notification.fcm.sender_mismatch").count()).isEqualTo(1);
    }

    @Test
    void 운영요청팩토리의401은본문없이재시도한다() {
        status.set(401);
        response.set(fcmError("THIRD_PARTY_AUTH_ERROR"));
        assertThat(send(transport())).isEqualTo(PushTransport.Result.RETRY);
        assertThatThrownBy(() -> FcmTransport.client(baseUrl()).post()
                .uri("/v1/projects/test-project/messages:send")
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("message", Map.of("token", "device-token")))
                .retrieve().toBodilessEntity())
                .isInstanceOf(RestClientResponseException.class)
                .satisfies(failure -> assertThat(((RestClientResponseException) failure)
                        .getResponseBodyAsString()).isEmpty());
    }

    private FcmTransport transport() {
        GoogleCredentials credentials = GoogleCredentials.create(
                new AccessToken("test-access-token", new Date(System.currentTimeMillis() + 3600000)));
        return new FcmTransport("test-project", credentials, baseUrl(), meters);
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private PushTransport.Result send(FcmTransport transport) {
        return transport.send("device-token", new RenderedPush("제목", "본문", Map.of(), false), true, "event");
    }

    private String fcmError(String code) {
        return "{\"error\":{\"details\":[{\"@type\":\"type.googleapis.com/google.firebase.fcm.v1.FcmError\","
                + "\"errorCode\":\"" + code + "\"}]}}";
    }
}

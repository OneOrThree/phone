package com.oneorthree.notification;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class DataClientContractTest {
    @ParameterizedTest
    @ValueSource(strings = {"2026-09-12T03:00:00.123Z", "2026-09-12T12:00:00+09:00"})
    void ackReadCarriesTheSameUserInPathAndHeader(String acknowledgedAt) throws Exception {
        UUID user = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        AtomicReference<String> subject = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> query = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/users/" + user + "/result-ack", exchange -> {
            subject.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            query.set(exchange.getRequestURI().getQuery());
            byte[] body = ("{\"acknowledged\":true,\"acknowledgedAt\":\"" + acknowledgedAt + "\"}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(user.toString().equals(subject.get()) ? 200 : 403, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            DataClient client = new DataClient("http://127.0.0.1:" + server.getAddress().getPort(), "fixture-token");
            assertThat(client.acknowledged(user, session)).isTrue();
            assertThat(subject.get()).isEqualTo(user.toString());
            assertThat(authorization.get()).isEqualTo("Bearer fixture-token");
            assertThat(query.get()).isEqualTo("sessionId=" + session);
        } finally {
            server.stop(0);
        }
    }
}

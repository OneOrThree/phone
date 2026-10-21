package com.oneorthree.realtime;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP heartbeat 계약 (GROMO-2341) — 앱({@code islandRealtime.ts})의 10s/10s 와 서버 협상이 맞는가, 그리고 서버가 정말
 * heartbeat 를 보내는가. 프레임을 직접 보려고 STOMP 클라이언트가 아니라 원시 WebSocket 으로 붙는다(Spring STOMP 클라이언트는
 * heartbeat 를 삼켜 보여 주지 않는다).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class StompHeartbeatIntegrationTest {

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Test
    @DisplayName("CONNECT heart-beat:10000,10000 → CONNECTED heart-beat:10000,10000, 그리고 서버 heartbeat(EOL)가 실제로 온다")
    void serverNegotiatesAndSendsHeartbeats() throws Exception {
        BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        WebSocketSession socket = new StandardWebSocketClient().execute(new AbstractWebSocketHandler() {
            @Override
            protected void handleTextMessage(WebSocketSession session, TextMessage message) {
                frames.add(message.getPayload());
            }

            @Override
            protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
                frames.add(StandardCharsets.UTF_8.decode(message.getPayload()).toString());
            }
        }, new WebSocketHttpHeaders(), URI.create("ws://localhost:" + port + "/ws/realtime"))
                .get(15, TimeUnit.SECONDS);
        try {
            socket.sendMessage(new TextMessage("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:10000,10000\n"
                    + "Authorization:" + bearer() + "\n\n\0"));

            String connected = frames.poll(15, TimeUnit.SECONDS);
            assertThat(connected).startsWith("CONNECTED\n").contains("heart-beat:10000,10000\n");

            // 브로커는 10초 주기로 훑어 «10초 넘게 아무것도 안 쓴» 세션에만 보낸다 — 최악 약 20초.
            String next = frames.poll(25, TimeUnit.SECONDS);
            assertThat(next).as("서버 heartbeat 는 EOL 한 바이트다").isEqualTo("\n");
        } finally {
            socket.close();
        }
    }

    private String bearer() {
        return "Bearer " + Jwts.builder()
                .subject(UUID.randomUUID().toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }
}

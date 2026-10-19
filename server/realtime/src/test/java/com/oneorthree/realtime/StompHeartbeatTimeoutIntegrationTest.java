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
import org.springframework.web.socket.CloseStatus;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * heartbeat 계약의 나머지 절반 (GROMO-2341) — 클라이언트가 약속한 heartbeat 를 3배 동안 보내지 않으면 서버가 닫는다.
 *
 * <p>근거(Spring 7.0.7): {@code SimpleBrokerMessageHandler.HeartbeatTask} 가 {@code now - lastReadTime >
 * readInterval}({@code max(클라이언트 cx, 서버 cy) × 3}) 인 세션에 {@code handleDisconnect} 를 부르고, 그 DISCONNECT_ACK 를
 * {@code StompSubProtocolHandler} 가 ERROR {@code Session closed.} 로 바꿔 보낸 뒤 1002 로 소켓을 닫는다. 값을 1s 로 줄여 ~4s
 * 안에 본다(운영 기본은 10s → 30s).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"chat.websocket.heartbeat.server-ms=1000", "chat.websocket.heartbeat.client-ms=1000"})
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class StompHeartbeatTimeoutIntegrationTest {

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Test
    @DisplayName("CONNECT heart-beat:1000,1000 뒤 아무것도 안 보내면 3×1s 뒤 ERROR 「Session closed.」와 함께 소켓이 닫힌다")
    void silentClientIsDisconnected() throws Exception {
        BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        CompletableFuture<CloseStatus> closed = new CompletableFuture<>();
        WebSocketSession socket = new StandardWebSocketClient().execute(new AbstractWebSocketHandler() {
            @Override
            protected void handleTextMessage(WebSocketSession session, TextMessage message) {
                frames.add(message.getPayload());
            }

            @Override
            protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
                frames.add(StandardCharsets.UTF_8.decode(message.getPayload()).toString());
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
                closed.complete(status);
            }
        }, new WebSocketHttpHeaders(), URI.create("ws://localhost:" + port + "/ws/realtime"))
                .get(15, TimeUnit.SECONDS);
        long connectedAt;
        try {
            socket.sendMessage(new TextMessage("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:1000,1000\n"
                    + "Authorization:" + bearer() + "\n\n\0"));
            assertThat(frames.poll(15, TimeUnit.SECONDS)).startsWith("CONNECTED\n").contains("heart-beat:1000,1000\n");
            connectedAt = System.nanoTime();

            CloseStatus status = closed.get(10, TimeUnit.SECONDS);
            long seconds = TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - connectedAt);
            assertThat(seconds).as("읽기 무활동 3×1s 이후, 스케줄 주기 1s 안쪽").isBetween(2L, 6L);
            assertThat(status.getCode()).isEqualTo(CloseStatus.PROTOCOL_ERROR.getCode());
            assertThat(frames).anySatisfy(frame -> assertThat(frame).startsWith("ERROR\n").contains("Session closed."));
        } finally {
            if (socket.isOpen()) {
                socket.close();
            }
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

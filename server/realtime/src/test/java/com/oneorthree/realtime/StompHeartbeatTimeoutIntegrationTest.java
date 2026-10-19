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
    @DisplayName("CONNECT heart-beat:1000,1000 뒤 아무것도 안 보내면 3×1s 뒤 서버가 1002 로 소켓을 닫는다")
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
        long connectSentAt;
        try {
            // 서버의 lastReadTime 은 CONNECT «수신» 시각이다 — 기준은 CONNECTED 수신이 아니라 CONNECT 전송 직전으로 잡는다.
            connectSentAt = System.nanoTime();
            socket.sendMessage(new TextMessage("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:1000,1000\n"
                    + "Authorization:" + bearer() + "\n\n\0"));
            assertThat(frames.poll(15, TimeUnit.SECONDS)).startsWith("CONNECTED\n").contains("heart-beat:1000,1000\n");

            CloseStatus status = closed.get(10, TimeUnit.SECONDS);
            long millis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - connectSentAt);
            // 목적은 «3배(3s) 뒤에 닫힌다» 이지 정밀 타이밍이 아니다. 하한 3s 는 전송 직전 기준이라 지연이 커져도 깨지지 않고
            // (서버 수신은 그보다 늦다), 상한은 판정 주기 1s + 여유를 둔 느슨한 값이다.
            assertThat(millis).as("읽기 무활동 3×1s 이후에만 닫힌다").isGreaterThanOrEqualTo(3000L).isLessThan(8000L);
            assertThat(status.getCode()).isEqualTo(CloseStatus.PROTOCOL_ERROR.getCode());
            // ERROR 「Session closed.」 프레임 자체는 단언하지 않는다 — 서버는 보내고 닫지만(StompSubProtocolHandler), 닫힘과 겹쳐
            // 클라이언트에 도착하지 않는 실행이 있었다(3회 중 3회 1002 는 같고 ERROR 만 빠짐). 계약은 «닫힌다»이다.
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

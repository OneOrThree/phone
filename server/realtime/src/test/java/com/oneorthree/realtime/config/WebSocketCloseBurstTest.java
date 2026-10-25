package com.oneorthree.realtime.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.tomcat.autoconfigure.servlet.TomcatServletWebServerAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.DispatcherServletAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.WebMvcAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 소켓 종료가 Tomcat의 기본 200개 작업 스레드를 한꺼번에 깨우던 경계만 재현한다. */
@SpringBootTest(classes = WebSocketCloseBurstTest.ProbeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext
class WebSocketCloseBurstTest {

    private static final int CONNECTIONS = 200;

    @LocalServerPort
    private int port;

    @Autowired
    private SlowCloseHandler handler;

    @Test
    @DisplayName("동시 소켓 종료는 32개 작업 이내에서 모두 정리된다 — 연결 수만큼 스레드를 만들지 않는다")
    void closeBurstIsBoundedAndFullyDrained() throws Exception {
        ExecutorService clients = Executors.newFixedThreadPool(8);
        List<WebSocket> sockets = new ArrayList<>();
        try {
            HttpClient client = HttpClient.newBuilder().executor(clients)
                    .connectTimeout(Duration.ofSeconds(5)).build();
            List<CompletableFuture<WebSocket>> openings = new ArrayList<>();
            for (int i = 0; i < CONNECTIONS; i++) {
                openings.add(client.newWebSocketBuilder().buildAsync(
                        URI.create("ws://127.0.0.1:" + port + "/close-probe"), new WebSocket.Listener() { }));
            }
            for (CompletableFuture<WebSocket> opening : openings) {
                sockets.add(opening.get(10, TimeUnit.SECONDS));
            }

            for (WebSocket socket : sockets) {
                socket.sendClose(WebSocket.NORMAL_CLOSURE, "test-complete");
            }

            assertThat(handler.finished.await(10, TimeUnit.SECONDS)).as("종료 콜백 전부 완료").isTrue();
            assertThat(handler.peak.get()).as("동시에 실행된 종료 콜백").isBetween(2, 32);
            assertThat(handler.active.get()).isZero();
        } finally {
            sockets.forEach(WebSocket::abort);
            clients.shutdownNow();
        }
    }

    /** DB·Redis 없이 실제 Tomcat과 application.yml의 운영 기본값을 사용한다. */
    @Configuration(proxyBeanMethods = false)
    @EnableWebSocket
    @ImportAutoConfiguration({TomcatServletWebServerAutoConfiguration.class,
        DispatcherServletAutoConfiguration.class, WebMvcAutoConfiguration.class})
    static class ProbeApplication {

        @Bean
        SlowCloseHandler slowCloseHandler() {
            return new SlowCloseHandler();
        }

        @Bean
        WebSocketConfigurer probeSockets(SlowCloseHandler handler) {
            return registry -> registry.addHandler(handler, "/close-probe");
        }
    }

    private static final class SlowCloseHandler extends TextWebSocketHandler {

        private final AtomicInteger active = new AtomicInteger();
        private final AtomicInteger peak = new AtomicInteger();
        private final CountDownLatch finished = new CountDownLatch(CONNECTIONS);

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws InterruptedException {
            peak.accumulateAndGet(active.incrementAndGet(), Math::max);
            try {
                // 종료 리스너의 동기 Redis I/O를 대신한다. CPU를 소비하거나 외부 서비스를 호출하지 않는다.
                Thread.sleep(50);
            } finally {
                active.decrementAndGet();
                finished.countDown();
            }
        }
    }
}

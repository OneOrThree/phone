package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 실제 실행기({@link OutboundSendBudget#newExecutor})와 실제 {@link ExecutorSubscribableChannel} 로 큐 포화 정책을 본다 —
 * 스레드 1·큐 1 로 줄여 셋째 프레임이 거부되게 만든다.
 */
class OutboundSendBudgetTest {

    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
    private final OutboundSendBudget budget = new OutboundSendBudget(sessions, meters, 1, 1, 1);
    private final ThreadPoolTaskExecutor executor = budget.newExecutor();
    private final CountDownLatch release = new CountDownLatch(1);
    private final List<String> handled = new CopyOnWriteArrayList<>();
    private ExecutorSubscribableChannel channel;

    private void start() {
        executor.initialize();
        channel = new ExecutorSubscribableChannel(executor);
        channel.setInterceptors(List.of(budget));
        channel.subscribe(message -> {
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            handled.add(SimpMessageHeaderAccessor.getSessionId(message.getHeaders()));
        });
    }

    @AfterEach
    void tearDown() {
        release.countDown();
        executor.shutdown();
    }

    @Test
    @DisplayName("큐가 차면 채팅 프레임을 버린 세션을 1008 OUTBOUND_QUEUE_FULL 로 닫는다 — 앱은 재연결 뒤 이력으로 메운다")
    void queueFullClosesTheChatSessionInsteadOfSilentlyDropping() throws Exception {
        start();
        WebSocketSession victim = socket("victim");
        WebSocketSession other = socket("other");
        String chat = "/topic/groups/" + UUID.randomUUID();

        assertThat(channel.send(frame("other", chat))).isTrue(); // 실행 중(막힘)
        assertThat(channel.send(frame("other", chat))).isTrue(); // 큐 1칸
        assertThat(channel.send(frame("victim", chat))).as("브로커에 예외를 올리지 않는다").isTrue();

        verify(victim, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
        verify(other, never()).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));
        assertThat(meters.counter("realtime.outbound.dropped", "reason", "queue_full").count()).isEqualTo(1.0);
        assertThat(meters.get("executor.queued").tag("name", "realtime-outbound").gauge().value()).isEqualTo(1.0);

        release.countDown();
        executor.getThreadPoolExecutor().shutdown();
        executor.getThreadPoolExecutor().awaitTermination(5, TimeUnit.SECONDS);
        assertThat(handled).containsExactly("other", "other");
        assertThat(meters.get("realtime.outbound.send").tag("destination_kind", "chat").timer().count())
                .isEqualTo(2);
    }

    @Test
    @DisplayName("이동 프레임이 거부돼도 세션을 닫는다 — 던지면 Spring 이 보낸 스레드(틱)에서 바로 실행해 막힌 소켓이 그 스레드를 잡는다")
    void queueFullClosesTheMovementSessionWithoutRunningItOnTheCaller() throws Exception {
        start();
        WebSocketSession mover = socket("mover");
        String movement = "/topic/islands/" + UUID.randomUUID() + "/movement";
        channel.send(frame("other", movement));
        channel.send(frame("other", movement));

        long started = System.nanoTime();
        assertThat(channel.send(frame("mover", movement))).isTrue();
        assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started))
                .as("호출 스레드에서 막힌 핸들러를 돌리지 않는다").isLessThan(1000);
        verify(mover, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
        assertThat(handled).doesNotContain("mover");
    }

    @Test
    @DisplayName("세션 송신 상한(4500 SESSION_NOT_RELIABLE)으로 닫힌 세션을 센다")
    void sessionLimitClosesAreCounted() {
        budget.closed(CloseStatus.SESSION_NOT_RELIABLE);
        budget.closed(CloseStatus.NORMAL);
        assertThat(meters.counter("realtime.outbound.dropped", "reason", "session_limit").count()).isEqualTo(1.0);
    }

    @Test
    void destinationKinds() {
        UUID id = UUID.randomUUID();
        assertThat(OutboundSendBudget.kindOf("/topic/groups/" + id)).isEqualTo("chat");
        assertThat(OutboundSendBudget.kindOf("/topic/islands/" + id + "/movement/snapshot")).isEqualTo("movement");
        assertThat(OutboundSendBudget.kindOf("/topic/islands/" + id + "/events")).isEqualTo("events");
        assertThat(OutboundSendBudget.kindOf("/topic/sea/rooms/" + id)).isEqualTo("sea");
        assertThat(OutboundSendBudget.kindOf(null)).isEqualTo("other");
    }

    private WebSocketSession socket(String id) {
        WebSocketSession socket = mock(WebSocketSession.class);
        when(socket.getId()).thenReturn(id);
        when(socket.isOpen()).thenReturn(true);
        sessions.opened(socket);
        return socket;
    }

    private static Message<byte[]> frame(String session, String destination) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId(session);
        headers.setDestination(destination);
        return MessageBuilder.createMessage("{}".getBytes(StandardCharsets.UTF_8), headers.getMessageHeaders());
    }
}

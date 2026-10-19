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
    private final CountDownLatch entered = new CountDownLatch(1);
    private final List<String> handled = new CopyOnWriteArrayList<>();
    private ExecutorSubscribableChannel channel;

    private void start() {
        executor.initialize();
        channel = new ExecutorSubscribableChannel(executor);
        channel.setInterceptors(List.of(budget));
        channel.subscribe(message -> {
            entered.countDown();
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
    @DisplayName("종료 예약된 세션의 다음 프레임은 큐에 들어가지 않는다 — dropped{closing}, 이미 큐에 있던 것도 버린다")
    void framesToAClosingSessionAreDroppedBeforeAndAfterTheQueue() throws Exception {
        start();
        socket("other");
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("other", chat)); // 실행 중(막힘)
        assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 핸들러에 들어갔다").isTrue();
        channel.send(frame("other", chat)); // 큐 1칸 — 아래 예약 «전»에 들어갔다
        channel.send(frame("other", chat)); // 거부 → other 종료 예약
        assertThat(budget.isClosing("other")).isTrue();

        assertThat(channel.send(frame("other", chat))).as("큐에 넣기 전에 버린다").isFalse();
        assertThat(executor.getThreadPoolExecutor().getQueue()).as("넣기 전 버림 — 큐는 예약 전의 1건 그대로").hasSize(1);
        assertThat(closingDropped()).isEqualTo(1.0);

        release.countDown();
        executor.getThreadPoolExecutor().shutdown();
        executor.getThreadPoolExecutor().awaitTermination(5, TimeUnit.SECONDS);
        assertThat(handled).as("예약 전에 실행 중이던 한 건만 나갔다 — 큐에 있던 건 꺼낼 때 버렸다").containsExactly("other");
        assertThat(closingDropped()).isEqualTo(2.0);
    }

    @Test
    @DisplayName("첫 세션의 close 가 막혀 있어도 둘째 세션은 예약 즉시 전달이 막히고 종료도 따로 진행된다")
    void aBlockedCloseDoesNotLetOtherClosingSessionsKeepReceiving() throws Exception {
        start();
        WebSocketSession stuck = socket("stuck");
        WebSocketSession second = socket("second");
        CountDownLatch unblockClose = new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            unblockClose.await(5, TimeUnit.SECONDS);
            return null;
        }).when(stuck).close(OutboundSendBudget.QUEUE_FULL);
        String chat = "/topic/groups/" + UUID.randomUUID();
        try {
            channel.send(frame("x", chat));
            channel.send(frame("x", chat));
            channel.send(frame("stuck", chat)); // 거부 → close 가 막힌다
            verify(stuck, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
            channel.send(frame("second", chat)); // 거부 → 예약

            assertThat(channel.send(frame("second", chat))).as("종료 전이라도 이미 막혔다").isFalse();
            verify(second, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL); // 종료 스레드 2개 — 막힌 close 를 기다리지 않는다
        } finally {
            unblockClose.countDown();
        }
    }

    @Test
    @DisplayName("소켓 종료 경로가 종료 예약을 지운다 — 누적되지 않는다")
    void closedSessionLeavesTheClosingSet() throws Exception {
        start();
        socket("victim");
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("x", chat));
        channel.send(frame("x", chat));
        channel.send(frame("victim", chat));
        assertThat(budget.isClosing("victim")).isTrue();

        budget.closed("victim", CloseStatus.POLICY_VIOLATION);
        assertThat(budget.isClosing("victim")).isFalse();

        // 이미 끊긴 세션이 거부되면 종료 시도 뒤 곧바로 지운다(종료 경로가 먼저 지나갔다).
        channel.send(frame("gone", chat));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (budget.isClosing("gone") && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertThat(budget.isClosing("gone")).isFalse();
    }

    @Test
    @DisplayName("종료가 실패하면(소켓이 열린 채) 예약을 푼다 — 전달만 영구히 막힌 좀비가 되지 않고 다음 프레임은 통과한다")
    void failedCloseReleasesTheReservation() throws Exception {
        start();
        WebSocketSession broken = socket("broken");
        org.mockito.Mockito.doThrow(new java.io.IOException("close failed")).when(broken)
                .close(OutboundSendBudget.QUEUE_FULL);
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("x", chat));
        channel.send(frame("x", chat));
        channel.send(frame("broken", chat)); // 거부 → 예약 → close 실패
        verify(broken, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (budget.isClosing("broken") && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertThat(budget.isClosing("broken")).isFalse();

        release.countDown(); // 큐가 회복됐다 — 밀린 두 건이 빠질 때까지 기다린다
        long drained = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (handled.size() < 2 && System.nanoTime() < drained) {
            Thread.sleep(10);
        }
        assertThat(channel.send(frame("broken", chat))).as("예약이 풀려 다시 전달 경로를 탄다").isTrue();
        executor.getThreadPoolExecutor().shutdown();
        executor.getThreadPoolExecutor().awaitTermination(5, TimeUnit.SECONDS);
        assertThat(handled).contains("broken");
    }

    private double closingDropped() {
        return meters.counter("realtime.outbound.dropped", "reason", "closing").count();
    }

    @Test
    @DisplayName("세션 송신 상한(4500 SESSION_NOT_RELIABLE)으로 닫힌 세션을 센다")
    void sessionLimitClosesAreCounted() {
        budget.closed("a", CloseStatus.SESSION_NOT_RELIABLE);
        budget.closed("b", CloseStatus.NORMAL);
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

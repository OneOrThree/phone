package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageHandlingRunnable;
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
    private final List<Thread> handlerThreads = new CopyOnWriteArrayList<>();
    private ExecutorSubscribableChannel channel;

    private void start() {
        executor.initialize();
        channel = new ExecutorSubscribableChannel(executor);
        channel.setInterceptors(List.of(budget));
        channel.subscribe(message -> {
            handlerThreads.add(Thread.currentThread());
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
        assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 핸들러에 들어갔다 — 가해로 닫히기 전에 실행 중이어야 큐 칸이 안 빈다").isTrue();
        assertThat(channel.send(frame("other", chat))).isTrue(); // 큐 1칸
        assertThat(channel.send(frame("victim", chat))).as("브로커에 예외를 올리지 않는다").isTrue();

        verify(victim, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
        verify(other).close(OutboundSendBudget.QUEUE_FULL); // 큐를 채운 쪽(최대 점유)이 가해로 먼저 닫힌다
        assertThat(meters.counter("realtime.outbound.dropped", "reason", "queue_full").count()).isEqualTo(1.0);
        assertThat(meters.get("executor.queued").tag("name", "realtime-outbound").gauge().value()).isEqualTo(1.0);

        release.countDown();
        executor.getThreadPoolExecutor().shutdown();
        executor.getThreadPoolExecutor().awaitTermination(5, TimeUnit.SECONDS);
        assertThat(handled).as("실행 중이던 한 건만 나갔다 — 큐에 있던 건 종료 예약이라 꺼낼 때 버렸다").containsExactly("other");
        assertThat(meters.get("realtime.outbound.send").tag("destination_kind", "chat").timer().count())
                .isEqualTo(1);
    }

    @Test
    @DisplayName("이동 프레임이 거부돼도 세션을 닫는다 — 던지면 Spring 이 보낸 스레드(틱)에서 바로 실행해 막힌 소켓이 그 스레드를 잡는다")
    void queueFullClosesTheMovementSessionWithoutRunningItOnTheCaller() throws Exception {
        start();
        WebSocketSession mover = socket("mover");
        List<Thread> closeThreads = new CopyOnWriteArrayList<>();
        CountDownLatch closeRecorded = new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            closeThreads.add(Thread.currentThread());
            closeRecorded.countDown(); // 기록한 «뒤» — verify(timeout) 성공은 이 본문의 완료를 보장하지 않는다
            return null;
        }).when(mover).close(OutboundSendBudget.QUEUE_FULL);
        String movement = "/topic/islands/" + UUID.randomUUID() + "/movement";
        channel.send(frame("other", movement));
        assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 실행기 워커의 핸들러에 들어갔다").isTrue();
        channel.send(frame("other", movement));

        assertThat(channel.send(frame("mover", movement))).isTrue();
        verify(mover, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
        assertThat(closeRecorded.await(2, TimeUnit.SECONDS)).isTrue();
        // 시간 대신 구조로 «호출 스레드에서 돌지 않음»을 본다 — close 는 전용 풀, 핸들러는 실행기 워커에서만 돈다.
        assertThat(closeThreads).singleElement().satisfies(thread -> {
            assertThat(thread.getName()).isEqualTo("realtime-outbound-close");
            assertThat(thread).isNotSameAs(Thread.currentThread());
        });
        assertThat(handlerThreads).isNotEmpty().allSatisfy(thread -> {
            assertThat(thread.getName()).startsWith("realtime-outbound-");
            assertThat(thread).isNotSameAs(Thread.currentThread());
        });
        assertThat(handled).doesNotContain("mover");
    }

    @Test
    @DisplayName("포화되면 가장 많이 점유한 세션을 먼저, 넘친 세션을 그 다음에 닫는다 — 둘 다 1008 이고 지표가 가른다")
    void queueFullClosesTheHeaviestSessionBeforeTheOverflowingOne() throws Exception {
        start();
        WebSocketSession hog = socket("hog");
        WebSocketSession overflow = socket("overflow");
        List<String> order = new CopyOnWriteArrayList<>();
        CountDownLatch bothClosed = new CountDownLatch(2);
        org.mockito.Mockito.doAnswer(invocation -> {
            order.add("hog");
            bothClosed.countDown();
            return null;
        }).when(hog).close(OutboundSendBudget.QUEUE_FULL);
        org.mockito.Mockito.doAnswer(invocation -> {
            order.add("overflow");
            bothClosed.countDown();
            return null;
        }).when(overflow).close(OutboundSendBudget.QUEUE_FULL);
        String chat = "/topic/groups/" + UUID.randomUUID();

        channel.send(frame("hog", chat)); // 실행 중(막힘)
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        channel.send(frame("hog", chat)); // 큐 1칸 — hog 가 2건 점유
        channel.send(frame("overflow", chat)); // 거부

        verify(overflow, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
        verify(hog).close(OutboundSendBudget.QUEUE_FULL);
        assertThat(bothClosed.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(order).containsExactly("hog", "overflow");
        assertThat(meters.counter("realtime.outbound.closed", "selected", "offender").count()).isEqualTo(1.0);
        assertThat(meters.counter("realtime.outbound.closed", "selected", "overflow").count()).isEqualTo(1.0);
    }

    @Test
    @DisplayName("넘친 세션이 곧 최대 점유자면 그 세션만 닫는다 — 덜 점유한 정상 세션을 불필요하게 닫지 않는다")
    void overflowingHeaviestSessionIsTheOnlyOneClosed() throws Exception {
        OutboundSendBudget wide = new OutboundSendBudget(sessions, meters, 1, 1, 3);
        ThreadPoolTaskExecutor wideExecutor = wide.newExecutor();
        wideExecutor.initialize();
        try {
            ExecutorSubscribableChannel wideChannel = new ExecutorSubscribableChannel(wideExecutor);
            wideChannel.setInterceptors(List.of(wide));
            wideChannel.subscribe(message -> {
                entered.countDown();
                try {
                    release.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            WebSocketSession hog = socket("hog");
            WebSocketSession healthy = socket("healthy");
            String chat = "/topic/groups/" + UUID.randomUUID();

            wideChannel.send(frame("hog", chat)); // 실행 중(막힘)
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            wideChannel.send(frame("hog", chat)); // 큐
            wideChannel.send(frame("hog", chat)); // 큐
            wideChannel.send(frame("healthy", chat)); // 큐 — 가득
            wideChannel.send(frame("hog", chat)); // 거부 — hog 3건, healthy 1건

            verify(hog, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);
            verify(healthy, never()).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));
            assertThat(meters.counter("realtime.outbound.closed", "selected", "overflow").count()).isEqualTo(1.0);
            assertThat(meters.counter("realtime.outbound.closed", "selected", "offender").count()).isZero();
        } finally {
            release.countDown();
            wideExecutor.shutdown();
        }
    }

    @Test
    @DisplayName("이미 종료 예약된 세션의 뒤늦은 거부는 다른 세션을 고르지 않는다 — 정상 세션이 연쇄로 닫히지 않는다")
    void lateRejectionOfAClosingSessionDoesNotCloseHealthySessions() throws Exception {
        start();
        WebSocketSession hog = socket("hog");
        WebSocketSession healthy = socket("healthy");
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("hog", chat)); // 실행 중(막힘)
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        channel.send(frame("healthy", chat)); // 큐 — 가득
        channel.send(frame("hog", chat)); // 1차 거부 — hog 2건(거부분 포함) > healthy 1건, hog 만 닫힌다
        verify(hog, timeout(2000)).close(OutboundSendBudget.QUEUE_FULL);

        // preSend 를 먼저 통과한 같은 세션의 동시 송신이 뒤늦게 거부되는 경우 — preSend 는 예약 뒤 막으므로 거부 핸들러에 직접 넣는다.
        MessageHandlingRunnable late = mock(MessageHandlingRunnable.class);
        when(late.getMessage()).thenAnswer(invocation -> frame("hog", chat));
        budget.rejectedExecution(late, executor.getThreadPoolExecutor());

        verify(healthy, never()).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));
        assertThat(meters.counter("realtime.outbound.dropped", "reason", "queue_full").count()).isEqualTo(2.0);
        assertThat(meters.counter("realtime.outbound.closed", "selected", "overflow").count()).isEqualTo(1.0);
        assertThat(meters.counter("realtime.outbound.closed", "selected", "offender").count()).isZero();
    }

    @Test
    @DisplayName("이미 끊긴 세션의 거부는 선별하지 않는다 — 종료 ACK 가 거부돼도 다른 세션이 연쇄로 닫히지 않는다")
    void rejectionOfADisconnectedSessionClosesNobody() throws Exception {
        start();
        WebSocketSession gone = socket("gone");
        WebSocketSession healthy = socket("healthy");
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("healthy", chat)); // 실행 중(막힘)
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        channel.send(frame("healthy", chat)); // 큐 — 가득
        sessions.closed("gone"); // 소켓 종료 콜백이 먼저 끝났다
        channel.send(frame("gone", chat)); // 브로커의 DISCONNECT_ACK 가 거부된다

        Thread.sleep(100); // closer 가 아무것도 하지 않음을 확인할 시간
        verify(healthy, never()).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));
        verify(gone, never()).close(org.mockito.ArgumentMatchers.any(CloseStatus.class));
        assertThat(budget.isClosing("gone")).isFalse();
        assertThat(meters.counter("realtime.outbound.dropped", "reason", "queue_full").count()).isEqualTo(1.0);
    }

    @Test
    @DisplayName("끝난 프레임은 세션별 대기 수에서 빠진다 — 항목이 남아 새지 않는다")
    void drainedFramesLeaveThePendingCount() throws Exception {
        start();
        release.countDown();
        channel.send(frame("idle", "/topic/groups/" + UUID.randomUUID()));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while ((handled.isEmpty() || budget.pendingOf("idle") != 0) && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertThat(handled).containsExactly("idle");
        assertThat(budget.pendingOf("idle")).isZero();
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
            assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 핸들러에 들어갔다 — 가해로 닫히기 전에 실행 중이어야 큐 칸이 안 빈다").isTrue();
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
        assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 핸들러에 들어갔다 — 가해로 닫히기 전에 실행 중이어야 큐 칸이 안 빈다").isTrue();
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
    @DisplayName("종료가 두 번 실패하면(소켓이 열린 채) 예약을 푼다 — 전달만 영구히 막힌 좀비가 되지 않고 다음 프레임은 통과한다")
    void twiceFailedCloseReleasesTheReservation() throws Exception {
        start();
        WebSocketSession broken = socket("broken");
        org.mockito.Mockito.doThrow(new java.io.IOException("close failed")).when(broken)
                .close(OutboundSendBudget.QUEUE_FULL);
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("x", chat));
        assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 핸들러에 들어갔다 — 가해로 닫히기 전에 실행 중이어야 큐 칸이 안 빈다").isTrue();
        channel.send(frame("x", chat));
        channel.send(frame("broken", chat)); // 거부 → 예약 → close 실패 → 재시도도 실패
        verify(broken, timeout(2000).times(2)).close(OutboundSendBudget.QUEUE_FULL);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (budget.isClosing("broken") && System.nanoTime() < deadline) {
            Thread.sleep(10);
        }
        assertThat(budget.isClosing("broken")).isFalse();

        release.countDown(); // 큐가 회복됐다 — 밀린 x 의 두 건이 빠질 때까지 기다린다
        long drained = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (budget.pendingOf("x") > 0 && System.nanoTime() < drained) {
            Thread.sleep(10);
        }
        assertThat(channel.send(frame("broken", chat))).as("예약이 풀려 다시 전달 경로를 탄다").isTrue();
        executor.getThreadPoolExecutor().shutdown();
        executor.getThreadPoolExecutor().awaitTermination(5, TimeUnit.SECONDS);
        assertThat(handled).contains("broken");
    }

    @Test
    @DisplayName("첫 close 가 실패해도 재시도가 성공하면 예약을 유지한다(전달 차단 유지) — 소켓 종료 경로가 푼다")
    void retriedCloseKeepsTheReservationUntilClosed() throws Exception {
        start();
        WebSocketSession flaky = socket("flaky");
        org.mockito.Mockito.doThrow(new java.io.IOException("close failed")).doNothing().when(flaky)
                .close(OutboundSendBudget.QUEUE_FULL);
        String chat = "/topic/groups/" + UUID.randomUUID();
        channel.send(frame("x", chat));
        assertThat(entered.await(2, TimeUnit.SECONDS)).as("첫 프레임이 핸들러에 들어갔다 — 가해로 닫히기 전에 실행 중이어야 큐 칸이 안 빈다").isTrue();
        channel.send(frame("x", chat));
        channel.send(frame("flaky", chat)); // 거부 → 예약 → 첫 close 실패 → 재시도 성공
        verify(flaky, timeout(2000).times(2)).close(OutboundSendBudget.QUEUE_FULL);
        Thread.sleep(100); // closer 가 끝날 시간 — 예약은 남아 있어야 한다
        assertThat(budget.isClosing("flaky")).as("소켓이 아직 연결 중 — 종료 경로를 기다린다").isTrue();
        assertThat(channel.send(frame("flaky", chat))).as("예약 중이라 여전히 막힌다").isFalse();

        budget.closed("flaky", OutboundSendBudget.QUEUE_FULL); // afterConnectionClosed
        assertThat(budget.isClosing("flaky")).isFalse();
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

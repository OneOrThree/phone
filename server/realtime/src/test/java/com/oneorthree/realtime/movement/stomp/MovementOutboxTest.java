package com.oneorthree.realtime.movement.stomp;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 세션 송신 큐의 «최신만 + reliable 무손실 + in-flight 1» — 티켓 2247 완료 조건 3 의 정본 테스트.
 *
 * <p>느린 구독자는 «완료 통지({@link MovementOutbox#onSent})가 오지 않는 채널»로 흉내 낸다 — 실제로도 in-flight
 * 프레임의 소켓 쓰기가 끝나야 {@code afterMessageHandled} 가 온다.
 */
class MovementOutboxTest {

    private static final String MOVEMENT = "/topic/islands/i/movement";
    private static final String SNAPSHOT = "/topic/islands/i/movement/snapshot";

    private final List<Message<?>> sent = new ArrayList<>();
    private final AtomicInteger overflowCalls = new AtomicInteger();
    private MovementOutbox outbox;

    @BeforeEach
    void setUp() {
        outbox = new MovementOutbox((message, timeout) -> sent.add(message), "s1", UUID.randomUUID(), MOVEMENT,
                SNAPSHOT, () -> {
                    overflowCalls.incrementAndGet();
                    throw new IllegalStateException("종료 콜백이 던져도 송신 큐는 멈추지 않는다");
                });
        outbox.subscribeMovement("sub-m");
        outbox.subscribeSnapshot("sub-s");
    }

    @Test
    @DisplayName("느린 구독자에게 Snapshot 100개를 밀어 넣어도 슬롯엔 마지막 1개만 남고 reliable 은 순서대로 전부 나간다")
    void slowSubscriberKeepsLatestSnapshotAndEveryReliableInOrder() {
        outbox.enqueueReliable(bytes("FullState"), true); // 바로 나가 in-flight 가 된다 — 그 뒤로 완료 통지가 없다.
        outbox.enqueueReliable(bytes("PathAccepted"), false);
        int superseded = 0;
        for (int i = 1; i <= 100; i++) {
            if (outbox.offerSnapshot(bytes("Snapshot-" + i))) {
                superseded++;
            }
        }
        outbox.enqueueReliable(bytes("Arrived"), false);

        assertThat(sent).as("완료 통지 전에는 in-flight 1건뿐이다").hasSize(1);
        assertThat(superseded).as("100개 중 99개는 못 보내고 덮어썼다").isEqualTo(99);

        drainBySimulatedCompletions();

        assertThat(payloads()).containsExactly("FullState", "PathAccepted", "Arrived", "Snapshot-100");
        assertThat(destinations()).containsExactly(MOVEMENT, MOVEMENT, MOVEMENT, SNAPSHOT);
        assertThat(sent).extracting(m -> SimpMessageHeaderAccessor.getSubscriptionId(m.getHeaders()))
                .containsExactly("sub-m", "sub-m", "sub-m", "sub-s");
        assertThat(sent).extracting(m -> SimpMessageHeaderAccessor.getSessionId(m.getHeaders())).containsOnly("s1");
        assertThat(sent).as("프레임마다 따로 된 완료 표식이 실린다")
                .allSatisfy(m -> assertThat(m.getHeaders().get(MovementOutbox.MARK))
                        .isInstanceOf(MovementOutbox.Ticket.class))
                .extracting(m -> m.getHeaders().get(MovementOutbox.MARK)).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("완료 통지가 없는 프레임은 워치독이 15초 뒤 풀어 다음 건을 보내고, 늦게 온 옛 통지는 아무것도 풀지 않는다")
    void watchdogReleasesAStuckFrameAndIgnoresItsLateCompletion() {
        outbox.enqueueReliable(bytes("FullState"), true); // 완료 통지가 끝내 안 오는 프레임
        outbox.enqueueReliable(bytes("PathAccepted"), false);
        outbox.enqueueReliable(bytes("Arrived"), false);
        MovementOutbox.Ticket stuck = (MovementOutbox.Ticket) sent.get(0).getHeaders().get(MovementOutbox.MARK);

        outbox.sweep(System.nanoTime());
        assertThat(sent).as("15초 전에는 기다린다").hasSize(1);

        outbox.sweep(System.nanoTime() + MovementOutbox.STUCK_NANOS);
        assertThat(payloads()).as("굳은 프레임을 끝난 것으로 치고 다음 건을 보낸다").containsExactly("FullState", "PathAccepted");

        stuck.release();
        assertThat(sent).as("옛 프레임의 늦은 통지가 지금 in-flight 를 풀면 동시에 두 건이 나간다").hasSize(2);
    }

    @Test
    @DisplayName("멈춘 동안 받는 reliable·Snapshot 은 쌓지 않고 버린다 — 재개하면 FullState 부터 다시 받는다")
    void suspendedOutboxDropsEverythingAndResyncsFromFullState() {
        outbox.enqueueReliable(bytes("FullState"), true); // in-flight 인 채로 멈춘다
        outbox.enqueueReliable(bytes("PathAccepted-1"), false);
        outbox.offerSnapshot(bytes("Snapshot-1"));

        outbox.suspend();
        assertThat(outbox.enqueueReliable(bytes("FullState-2"), true)).as("멈춘 동안은 FullState 도 버린다").isZero();
        assertThat(outbox.offerSnapshot(bytes("Snapshot-2"))).isFalse();
        drainBySimulatedCompletions();
        assertThat(payloads()).as("이미 나간 한 건만 — 덱·슬롯에 있던 것도 버렸다").containsExactly("FullState");

        outbox.resume();
        assertThat(outbox.enqueueReliable(bytes("Arrived"), false)).as("재개 직후 FullState 전 사건은 버린다").isZero();
        outbox.enqueueReliable(bytes("FullState-resync"), true);
        outbox.enqueueReliable(bytes("PathAccepted-2"), false);
        drainBySimulatedCompletions();

        assertThat(payloads()).containsExactly("FullState", "FullState-resync", "PathAccepted-2");
        assertThat(overflowCalls).as("쌓지 않으므로 큐 상한과 다툴 일이 없다").hasValue(0);
    }

    @Test
    @DisplayName("⑤ 멈추기 전에 채널에 넘긴 프레임도 실행기가 꺼낼 때 버리고 in-flight 를 푼다 — 재개 뒤 FullState 가 곧바로 나간다")
    void frameHandedOffBeforeSuspendIsDroppedAndReleasesInFlight() {
        MovementOutboundInterceptor interceptor = new MovementOutboundInterceptor();
        outbox.enqueueReliable(bytes("FullState"), true); // 채널에 넘어갔고 실행기에 밀려 있다(완료 통지 전)
        outbox.enqueueReliable(bytes("PathAccepted"), false);

        outbox.suspend();
        assertThat(interceptor.beforeHandle(sent.get(0), null, null)).as("멈춘 outbox 의 프레임은 버린다").isNull();

        outbox.resume();
        outbox.enqueueReliable(bytes("FullState-resync"), true);
        assertThat(payloads()).as("버리면서 in-flight 를 풀었다 — 완료 통지 없이 다음 건이 나간다")
                .containsExactly("FullState", "FullState-resync");
        assertThat(interceptor.beforeHandle(sent.get(1), null, null)).as("살아 있으면 그대로 내보낸다")
                .isSameAs(sent.get(1));
        outbox.close();
        assertThat(interceptor.beforeHandle(sent.get(1), null, null)).as("닫혔어도 버린다").isNull();
    }

    @Test
    @DisplayName("② 멈추기 전에 넘긴 프레임은 실행기가 꺼내기 전에 재개됐어도 버린다 — 재개 뒤 첫 메시지는 재동기화 FullState")
    void frameHandedOffBeforeSuspendIsDroppedEvenIfResumedFirst() {
        MovementOutboundInterceptor interceptor = new MovementOutboundInterceptor();
        outbox.enqueueReliable(bytes("FullState"), true);
        outbox.onSent();
        outbox.enqueueReliable(bytes("PathAccepted"), false); // 채널에 넘어갔고 실행기에 밀려 있다

        outbox.suspend();
        outbox.resume(); // 실행기가 꺼내기 전에 재판정이 통과했다
        outbox.enqueueReliable(bytes("FullState-resync"), true); // 옛 프레임(in-flight) 뒤에서 기다린다

        List<String> delivered = new ArrayList<>();
        for (int i = 1; i < sent.size(); i++) { // 실행기 흉내 — 꺼낸 순서대로 beforeHandle → 전송 → 완료 통지
            Message<?> frame = sent.get(i);
            if (interceptor.beforeHandle(frame, null, null) != null) {
                delivered.add(new String((byte[]) frame.getPayload(), StandardCharsets.UTF_8));
                interceptor.afterMessageHandled(frame, null, null, null);
            }
        }
        assertThat(delivered).as("멈추기 전 PathAccepted 는 버리고 재동기화 FullState 가 첫 메시지")
                .containsExactly("FullState-resync");
    }

    @Test
    @DisplayName("① 자기 FullState 전 Snapshot 은 슬롯에도 두지 않고 버린다 — snapshot 을 먼저 구독했어도, movement 를 해지해도 같다")
    void snapshotsBeforeTheOwnFullStateAreDropped() {
        List<Message<?>> early = new ArrayList<>();
        MovementOutbox snapshotFirst = new MovementOutbox((message, timeout) -> early.add(message), "s3",
                UUID.randomUUID(), MOVEMENT, SNAPSHOT, () -> { });
        snapshotFirst.subscribeSnapshot("sub-s");
        snapshotFirst.offerSnapshot(bytes("Snapshot-0"));
        assertThat(early).as("snapshot 만 먼저 구독 — FullState 가 올 길이 아직 없다").isEmpty();

        outbox.offerSnapshot(bytes("Snapshot-1")); // 구독 직후, 자기 FullState 전
        outbox.enqueueReliable(bytes("FullState"), true);
        outbox.offerSnapshot(bytes("Snapshot-2"));
        drainBySimulatedCompletions();
        assertThat(payloads()).containsExactly("FullState", "Snapshot-2");

        outbox.unsubscribeMovement("sub-m"); // 퇴장 — 남은 snapshot 구독도 다시 자기 FullState 전까지 받지 않는다
        outbox.offerSnapshot(bytes("Snapshot-3"));
        drainBySimulatedCompletions();
        assertThat(payloads()).containsExactly("FullState", "Snapshot-2");
    }

    @Test
    @DisplayName("구독 직후 첫 reliable 은 그 세션 한정 FullState 다 — 그 전에 온 다른 사건·전원 FullState 는 버린다")
    void reliableEventsBeforeTheFirstFullStateAreDropped() {
        assertThat(outbox.enqueueReliable(bytes("PathAccepted"), false)).isZero();
        assertThat(outbox.enqueueReliable(bytes("FullState-ALL"), false)).as("남의 입장이 낸 전원 FullState").isZero();
        outbox.enqueueReliable(bytes("FullState"), true);
        outbox.enqueueReliable(bytes("Arrived"), false);

        drainBySimulatedCompletions();

        assertThat(payloads()).containsExactly("FullState", "Arrived");
    }

    @Test
    @DisplayName("reliable 상한을 넘기면 더 받지 않고, 다음 완료 통지 때 한 번만 소켓 종료를 요청한다")
    void overflowStopsTheOutboxAndRequestsCloseOnNextCompletion() {
        outbox.enqueueReliable(bytes("FullState"), true); // in-flight
        for (int i = 0; i < MovementOutbox.RELIABLE_LIMIT; i++) {
            assertThat(outbox.enqueueReliable(bytes("r" + i), false)).isPositive();
        }
        assertThat(outbox.enqueueReliable(bytes("over"), false)).isEqualTo(-1);
        assertThat(overflowCalls).as("틱 스레드에서는 닫지 않는다").hasValue(0);

        outbox.onSent();
        outbox.onSent();

        assertThat(overflowCalls).hasValue(1);
        assertThat(sent).as("상한을 넘긴 뒤로는 아무것도 보내지 않는다").hasSize(1);
        assertThat(outbox.enqueueReliable(bytes("late"), false)).isZero();
    }

    @Test
    @DisplayName("movement 구독을 해지하면 밀린 reliable 을 버리고, 채널이 받지 않은 프레임은 완료 없이 다음으로 넘어간다")
    void unsubscribeDropsQueuedReliableAndRejectedSendDoesNotStall() {
        outbox.enqueueReliable(bytes("FullState"), true);
        outbox.enqueueReliable(bytes("PathAccepted"), false);
        assertThat(outbox.unsubscribeMovement("sub-m")).isTrue();
        outbox.onSent();
        assertThat(payloads()).containsExactly("FullState");

        List<Message<?>> refused = new ArrayList<>();
        MovementOutbox stubborn = new MovementOutbox((message, timeout) -> {
            refused.add(message);
            return false;
        }, "s2", UUID.randomUUID(), MOVEMENT, SNAPSHOT, () -> { });
        stubborn.subscribeMovement("m");
        stubborn.enqueueReliable(bytes("FullState"), true);
        stubborn.enqueueReliable(bytes("Arrived"), false);
        assertThat(refused).as("완료 통지가 안 오는 거절도 멈추지 않고 다음 건을 시도한다").hasSize(2);
    }

    private void drainBySimulatedCompletions() {
        for (int guard = 0; guard < 10; guard++) {
            outbox.onSent();
        }
    }

    private List<String> payloads() {
        List<String> out = new ArrayList<>();
        for (Message<?> message : sent) {
            out.add(new String((byte[]) message.getPayload(), StandardCharsets.UTF_8));
        }
        return out;
    }

    private List<String> destinations() {
        List<String> out = new ArrayList<>();
        for (Message<?> message : sent) {
            out.add(SimpMessageHeaderAccessor.getDestination(message.getHeaders()));
        }
        return out;
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }
}

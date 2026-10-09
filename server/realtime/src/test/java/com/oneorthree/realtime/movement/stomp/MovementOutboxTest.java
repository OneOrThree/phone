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
                SNAPSHOT, overflowCalls::incrementAndGet);
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
        assertThat(sent).as("완료 통지를 받는 표식은 이 outbox 자신이다")
                .allSatisfy(m -> assertThat(m.getHeaders().get(MovementOutbox.MARK)).isSameAs(outbox));
    }

    @Test
    @DisplayName("구독 직후 첫 reliable 은 FullState 다 — 그 전에 온 다른 사건은 버린다")
    void reliableEventsBeforeTheFirstFullStateAreDropped() {
        assertThat(outbox.enqueueReliable(bytes("PathAccepted"), false)).isZero();
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

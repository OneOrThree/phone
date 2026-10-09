package com.oneorthree.realtime.movement;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link MovementTicker} 가 STOMP 인바운드 스레드({@code clientInboundChannel})와 분리된 전용 스레드에서
 * 도는지 — Spring 컨텍스트 없이 직접 생성해서 확인한다(티켓 2246 완료 조건 4, 계약 §4).
 */
class MovementTickerTest {

    @Test
    @DisplayName("방 콜백은 movement-tick 스레드에서 실행된다")
    void tickCallbackRunsOnDedicatedThread() throws InterruptedException {
        AtomicReference<String> observedThreadName = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        RoomRuntime.Listener captureThreadName = new RoomRuntime.Listener() {
            @Override
            public void onEvent(UUID islandId, MovementEvent event, Target target) {
                observedThreadName.set(Thread.currentThread().getName());
                latch.countDown();
            }

            @Override
            public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
            }
        };
        MovementRooms rooms = new MovementRooms(captureThreadName);
        // join 을 큐에 넣는다 — tick 이 돌면 FullState 를 내며 Listener 가 불린다.
        rooms.roomFor(UUID.randomUUID()).join(UUID.randomUUID(), "session-1");

        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());
        ticker.start();
        try {
            assertThat(latch.await(2, TimeUnit.SECONDS)).as("2초 안에 틱 콜백이 와야 한다").isTrue();
            assertThat(observedThreadName.get()).startsWith(MovementTicker.THREAD_NAME);
        } finally {
            ticker.stop();
        }
    }
}

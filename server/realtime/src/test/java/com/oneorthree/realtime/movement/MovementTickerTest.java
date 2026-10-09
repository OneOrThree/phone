package com.oneorthree.realtime.movement;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
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

    /** 이벤트 내용은 안 보고 방 수명(제거·유지)만 살피는 테스트용 — 아무 것도 하지 않는다. */
    private static final class NoopListener implements RoomRuntime.Listener {
        @Override
        public void onEvent(UUID islandId, MovementEvent event, Target target) {
        }

        @Override
        public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        }
    }

    private static MovementEvent.ActorState actorIn(MovementEvent.FullState state, UUID userId) {
        for (MovementEvent.ActorState a : state.actors()) {
            if (a.userId().equals(userId)) {
                return a;
            }
        }
        return null;
    }

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

    // ── codex P1/P2: 빈 방 삭제 경합 — MovementRooms+MovementTicker 조합 ──────
    //
    // start()/stop() 의 실제 50ms 스케줄러는 쓰지 않는다 — 10분 창(N23)을 재현하려면 틱 수천 번이
    // 필요해 실제 대기로는 비현실적이다. tickAllRooms() 를 직접 빠르게 반복 호출한다(패키지 전용 시임).

    @Test
    @DisplayName("MovementRooms.join 은 remove 와 같은 섬 키의 compute 안에서 돌아, 그 사이에 걸려도 join 을"
            + " 유실하지 않는다(codex P1, 2246 보완2 — roomFor 를 거치지 않는 공개 API 로 교체)")
    void joinAndRemoveOnSameIslandNeverLoseTheJoin() {
        MovementRooms rooms = new MovementRooms(new NoopListener());
        UUID islandId = UUID.randomUUID();
        RoomRuntime room = rooms.roomFor(islandId); // 들여다보기 전용 — 아무도 없다, 지금은 isRemovable() true.
        assertThat(room.isRemovable()).isTrue();

        UUID userId = UUID.randomUUID();
        rooms.join(islandId, userId, "s1"); // 공개 API — compute 안에서 방 확보 + 큐 등록이 한 번에 돈다.

        rooms.remove(islandId); // 같은 키라 위 join 의 compute 뒤에만 실행될 수 있다 — 재확인은 false.

        assertThat(rooms.rooms()).as("join 이 이미 큐에 들어간 뒤라 지우면 안 된다").containsKey(islandId);

        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());
        ticker.tickAllRooms(); // 다음 틱에 큐가 드레인돼 join 이 실제로 반영돼야 한다(유실 없음).
        assertThat(actorIn(room.fullStateOf(), userId)).as("큐에 있던 join 이 유실 없이 처리돼야 한다").isNotNull();
    }

    @Test
    @DisplayName("MovementRooms.join 과 remove 를 다른 스레드에서 수천 번 동시에 돌려도 join 이 유실되지"
            + " 않는다(codex P1 compute 경합 스트레스, 2246 보완2)")
    void concurrentJoinAndRemoveNeverLoseAnActor() throws InterruptedException {
        MovementRooms rooms = new MovementRooms(new NoopListener());
        UUID islandId = UUID.randomUUID();
        int joinCount = 5000;
        List<UUID> userIds = new ArrayList<>(joinCount);
        for (int i = 0; i < joinCount; i++) {
            userIds.add(UUID.randomUUID());
        }

        Thread joiner = new Thread(() -> {
            for (int i = 0; i < joinCount; i++) {
                rooms.join(islandId, userIds.get(i), "session-" + i);
            }
        }, "joiner");
        Thread remover = new Thread(() -> {
            for (int i = 0; i < joinCount; i++) {
                rooms.remove(islandId);
            }
        }, "remover");

        joiner.start();
        remover.start();
        joiner.join(1000);
        remover.join(1000);

        // 두 스레드가 끝난 뒤 드레인한다 — remove 가 중간에 성공해 방이 갈렸어도 각 방은 자기 큐만큼은
        // 전부 턴다(여러 번 돌려 안전하게 비운다).
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());
        for (int i = 0; i < 5; i++) {
            ticker.tickAllRooms();
        }

        int totalActors = 0;
        for (RoomRuntime room : rooms.rooms().values()) {
            totalActors += room.fullStateOf().actors().size();
        }
        assertThat(totalActors).as("join %d 건이 어느 방으로 갈렸든 전부 살아 있어야 한다", joinCount)
                .isEqualTo(joinCount);
    }

    @Test
    @DisplayName("마지막 퇴장 뒤에도 방이 유지돼 10분 안 재입장하면 MovementRooms+MovementTicker 조합에서도"
            + " 위치가 복원된다(N23, codex P2)")
    void roomSurvivesLastDepartureAndRestoresPositionViaRoomsAndTicker() {
        MovementRooms rooms = new MovementRooms(new NoopListener());
        UUID islandId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RoomRuntime room = rooms.roomFor(islandId);
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());

        room.join(userId, "s1");
        ticker.tickAllRooms();
        room.accept("s1", new MoveIntent(1, 1, 1.5, 0.5)); // 스폰과 다른 곳으로 — "떠난 자리" 를 만든다.
        MovementEvent.ActorState state;
        int guard = 0;
        do {
            ticker.tickAllRooms();
            state = actorIn(room.fullStateOf(), userId);
        } while (state.state() != MotionState.IDLE && ++guard < 10);
        double departedX = state.x();
        double departedY = state.y();
        assertThat(departedX).as("스폰과 달라야 \"떠난 자리\" 검증이 의미 있다").isNotEqualTo(0.5);

        room.leave("s1");
        ticker.tickAllRooms(); // 마지막 퇴장 — departed 기억이 남아 방이 지워지면 안 된다.
        assertThat(rooms.rooms()).as("퇴장 위치 기억이 남아 있는 동안 방이 지워지면 안 된다").containsKey(islandId);

        room.join(userId, "s2"); // 10분 한참 안 — 재입장.
        ticker.tickAllRooms();

        MovementEvent.ActorState rejoined = actorIn(room.fullStateOf(), userId);
        assertThat(rejoined.x()).isEqualTo(departedX);
        assertThat(rejoined.y()).isEqualTo(departedY);
    }

    @Test
    @DisplayName("퇴장 기억이 10분을 넘기면 비워지고 방도 MovementRooms 에서 제거된다(N23, codex P2)")
    void roomIsRemovedFromRoomsAfterDepartedMemoryExpires() {
        MovementRooms rooms = new MovementRooms(new NoopListener());
        UUID islandId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RoomRuntime room = rooms.roomFor(islandId);
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());

        room.join(userId, "s1");
        ticker.tickAllRooms();
        room.leave("s1");
        ticker.tickAllRooms(); // 퇴장 — departed 기록, 방은 아직 유지된다.
        assertThat(rooms.rooms()).containsKey(islandId);

        long ticksToExpire = MovementRules.DEFAULT.ticksFor(10 * 60 * 1000L) + 1; // 10분 창을 지난 뒤.
        for (long i = 0; i < ticksToExpire; i++) {
            ticker.tickAllRooms();
        }

        assertThat(rooms.rooms()).as("퇴장 기억이 만료되면 아무도 없는 방도 제거돼야 한다").doesNotContainKey(islandId);
    }
}

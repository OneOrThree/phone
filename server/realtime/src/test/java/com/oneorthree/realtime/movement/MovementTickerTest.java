package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.Cell;
import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.NavJsonLoader;
import com.oneorthree.realtime.movement.nav.WorldCoords;
import com.oneorthree.realtime.movement.nav.WorldPoint;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
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

    /**
     * 첫 onEvent 호출에서만 {@link AssertionError}(Error, RuntimeException 아님) 를 던지는
     * Listener(2246 보완11) — {@link RoomRuntime#emit}·{@link MovementTicker#tickAllRooms(boolean)} 의
     * {@code RuntimeException} 가드를 전부 뚫고 {@link MovementTicker#runTick()} 의 최상위
     * {@code catch (Throwable)} 까지 올라오는 경로를 재현한다.
     */
    private static final class ThrowingOnceListener implements RoomRuntime.Listener {
        private final AtomicInteger callCount = new AtomicInteger();

        @Override
        public void onEvent(UUID islandId, MovementEvent event, Target target) {
            if (callCount.getAndIncrement() == 0) {
                throw new AssertionError("runTick 최상위 Throwable 가드 재현(2246 보완11)");
            }
        }

        @Override
        public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        }
    }

    /**
     * 방마다 처음 onEvent 가 불릴 때(섬별 최초 1회) {@link AssertionError} 를 던지는 Listener(2246
     * 보완13) — 여러 방을 등록해도 {@code rooms.rooms()} 의 순회 순서와 무관하게 "앞서 처리된 방의
     * Error 가 같은 사이클의 다른 방 처리를 막는지" 를 검증할 수 있다 — 어느 방이 먼저 돌든 그 방도
     * 자기 차례에 한 번은 던진다.
     */
    private static final class ThrowingOncePerIslandListener implements RoomRuntime.Listener {
        private final Set<UUID> thrown = ConcurrentHashMap.newKeySet();

        @Override
        public void onEvent(UUID islandId, MovementEvent event, Target target) {
            if (thrown.add(islandId)) {
                throw new AssertionError("방 단위 Throwable 가드 재현(2246 보완13)");
            }
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
        MovementRooms rooms = new MovementRooms(captureThreadName, new SimpleMeterRegistry());
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
        MovementRooms rooms = new MovementRooms(new NoopListener(), new SimpleMeterRegistry());
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
        MovementRooms rooms = new MovementRooms(new NoopListener(), new SimpleMeterRegistry());
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
        MovementRooms rooms = new MovementRooms(new NoopListener(), new SimpleMeterRegistry());
        UUID islandId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RoomRuntime room = rooms.roomFor(islandId);
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());

        room.join(userId, "s1");
        ticker.tickAllRooms();
        room.accept(userId, "s1", new MoveIntent(1, 1, 1.5, 0.5)); // 스폰과 다른 곳으로 — "떠난 자리" 를 만든다.
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
    @DisplayName("퇴장 기억이 10분을 넘기면 비워지고 방도 MovementRooms 에서 제거된다(N23, codex P2, 2246 보완16"
            + " — 가짜 벽시계를 직접 전진시켜 검증한다)")
    void roomIsRemovedFromRoomsAfterDepartedMemoryExpires() {
        // 만료 판정이 serverTick 차이 대신 벽시계 나노초로 바뀌어(2246 보완16) 틱 수천 번을 돌릴 필요가
        // 없다 — 가짜 시계(nanos)를 주입한 MovementRooms 로 만든 방은 이 배열 하나를 공유해 직접 전진시킬
        // 수 있다.
        long[] nanos = {0L};
        MovementRooms rooms = new MovementRooms(new NoopListener(), new SimpleMeterRegistry(), () -> nanos[0]);
        UUID islandId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        RoomRuntime room = rooms.roomFor(islandId);
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());

        room.join(userId, "s1");
        ticker.tickAllRooms();
        room.leave("s1");
        ticker.tickAllRooms(); // 퇴장 — departed 기록(이 시점의 nanos[0]), 방은 아직 유지된다.
        assertThat(rooms.rooms()).containsKey(islandId);

        nanos[0] += TimeUnit.MINUTES.toNanos(10) + 1; // 10분 창을 1ns 넘겨 벽시계를 전진시킨다.
        ticker.tickAllRooms(); // 한 틱 안에서 prune(만료) 과 isRemovable 재확인·제거가 함께 끝난다.

        assertThat(rooms.rooms()).as("퇴장 기억이 만료되면 아무도 없는 방도 제거돼야 한다").doesNotContainKey(islandId);
    }

    // ── codex P2: 2246 보완4 — catch-up 틱에서는 Snapshot 을 발행하지 않는다 ──────

    @Test
    @DisplayName("isCatchUp: 직전 틱 시작 뒤 반 주기(tickNanos/2) 가 안 지났으면 true, 지났으면"
            + " false(경계값, 나노초 단위, codex P2, 2246 보완4·보완11)")
    void isCatchUpBoundary() {
        long tickNanos = 50_000_000L; // 50ms.
        assertThat(MovementTicker.isCatchUp(100_000_000L, 100_000_000L, tickNanos)).as("diff 0ms").isTrue();
        assertThat(MovementTicker.isCatchUp(100_000_000L, 124_000_000L, tickNanos)).as("diff 24ms").isTrue();
        assertThat(MovementTicker.isCatchUp(100_000_000L, 125_000_000L, tickNanos))
                .as("diff 25ms(정확히 반 주기) 는 false").isFalse();
        assertThat(MovementTicker.isCatchUp(100_000_000L, 149_000_000L, tickNanos)).as("diff 49ms").isFalse();
        assertThat(MovementTicker.isCatchUp(100_000_000L, 150_000_000L, tickNanos)).as("diff 50ms(한 주기) 는 false")
                .isFalse();
        assertThat(MovementTicker.isCatchUp(0L, 10_000_000L, tickNanos))
                .as("첫 실행(previousNanos=0) 은 catch-up 이 아니다").isFalse();
    }

    @Test
    @DisplayName("tickAllRooms(false) 는 이동은 그대로 전진시키되 Snapshot 은 전혀 발행하지"
            + " 않는다(codex P2, 2246 보완4)")
    void tickAllRoomsFalseAdvancesMovementButSkipsSnapshot() {
        List<MovementEvent.Snapshot> snapshots = new ArrayList<>();
        RoomRuntime.Listener listener = new RoomRuntime.Listener() {
            @Override
            public void onEvent(UUID islandId, MovementEvent event, Target target) {
            }

            @Override
            public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
                snapshots.add(snapshot);
            }
        };
        MovementRooms rooms = new MovementRooms(listener, new SimpleMeterRegistry());
        UUID islandId = UUID.randomUUID();
        RoomRuntime room = rooms.roomFor(islandId);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");

        NavGrid grid = NavJsonLoader.loadBundled();
        Cell entranceCell = grid.entrances().values().iterator().next();
        WorldPoint target = WorldCoords.cellCenter(entranceCell);
        room.accept(userId, "s1", new MoveIntent(1, 1, target.x(), target.y()));

        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());
        ticker.tickAllRooms(false); // join+accept 가 한 틱에 같이 드레인 — catch-up 이라 Snapshot 없어야 한다.

        assertThat(actorIn(room.fullStateOf(), userId).state()).as("catch-up 틱에서도 이동은 전진한다")
                .isEqualTo(MotionState.MOVING);
        assertThat(snapshots).as("catch-up 틱은 Snapshot 을 전혀 내지 않는다").isEmpty();
        assertThat(ticker.skippedSnapshotCount()).as("catch-up 틱 1회 — 카운터 1 증가").isEqualTo(1L);
    }

    // ── codex PR 리뷰(2246 보완11): runTick() 최상위 Throwable 가드 ──────────

    @Test
    @DisplayName("runTick: 한 방의 콜백이 Error(AssertionError) 를 던져도 scheduleAtFixedRate 가 영구"
            + " 취소되지 않고, 다음 runTick 이 다른 방의 join 을 계속 반영한다(2246 보완11 — RuntimeException"
            + " 이 아니라 Throwable 전체를 가드해야 하는 이유)")
    void runTickSurvivesErrorFromOneRoomAndKeepsTickingOnNextInvocation() {
        ThrowingOnceListener listener = new ThrowingOnceListener();
        MovementRooms rooms = new MovementRooms(listener, new SimpleMeterRegistry());
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());
        UUID islandX = UUID.randomUUID();
        UUID userX = UUID.randomUUID();
        rooms.join(islandX, userX, "sx"); // 이 join 의 FullState 전송(onEvent 첫 호출)에서 Error 가 난다.

        ticker.runTick(); // Error 가 여기서 삼켜져야 한다 — 밖으로 새면 이 호출 자체가 테스트를 실패시킨다.

        assertThat(actorIn(rooms.roomFor(islandX).fullStateOf(), userX))
                .as("emit() 이 던지기 전에 상태 변경(actor 생성)은 이미 끝나 있다").isNotNull();

        UUID islandY = UUID.randomUUID();
        UUID userY = UUID.randomUUID();
        rooms.join(islandY, userY, "sy"); // 다음 runTick 에 반영돼야 한다 — 영구 취소됐다면 반영되지 않는다.

        ticker.runTick(); // 두 번째 호출 — Listener 는 이제(callCount>=1) 더 안 던진다.

        assertThat(actorIn(rooms.roomFor(islandY).fullStateOf(), userY))
                .as("Error 뒤에도 다음 runTick 이 계속 돌아야 새 join 이 반영된다").isNotNull();
    }

    // ── codex P2(2246 보완13): tickAllRooms 의 방 단위 가드를 Throwable 로 넓힌다 ──────

    @Test
    @DisplayName("runTick: 같은 사이클에서 먼저 처리된 방이 Error 를 던져도 그 뒤 방은 같은 호출 안에서"
            + " 그대로 틱을 받는다(2246 보완13 — 기존 테스트는 다음 호출만 확인했다)")
    void errorFromOneRoomStillLetsOtherRoomsTickInTheSameCycle() {
        ThrowingOncePerIslandListener listener = new ThrowingOncePerIslandListener();
        MovementRooms rooms = new MovementRooms(listener, new SimpleMeterRegistry());
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());

        UUID islandA = UUID.randomUUID();
        UUID userA = UUID.randomUUID();
        UUID islandB = UUID.randomUUID();
        UUID userB = UUID.randomUUID();
        rooms.join(islandA, userA, "sa");
        rooms.join(islandB, userB, "sb"); // 두 방 다 join 대기 — 어느 쪽이 먼저 돌든 각자 처음 emit 에서 던진다.

        ticker.runTick(); // 한 번만 — 예외가 밖으로 새면 이 호출 자체가 테스트를 실패시킨다.

        assertThat(actorIn(rooms.roomFor(islandA).fullStateOf(), userA))
                .as("섬 A 가 먼저 돌았든 나중에 돌았든 이번 한 번의 호출에서 join 이 반영돼야 한다").isNotNull();
        assertThat(actorIn(rooms.roomFor(islandB).fullStateOf(), userB))
                .as("섬 B 도 마찬가지 — 한 방의 Error 가 같은 사이클의 다른 방 처리를 막으면 안 된다").isNotNull();
    }

    // ── codex P2(2246 보완13): catch-up 연속 상한 — MAX_CATCH_UP_TICKS 초과는 틱 자체를 건너뛴다 ──

    @Test
    @DisplayName("nextCatchUpStreak/exceedsMaxCatchUp: 정상 간격이면 0 으로 리셋, catch-up 이면 1씩"
            + " 증가하고 MAX_CATCH_UP_TICKS(20) 을 넘겨야(21부터) true 다(순수 함수 경계, 2246 보완13)")
    void catchUpStreakBoundary() {
        assertThat(MovementTicker.nextCatchUpStreak(5L, false)).as("정상 간격이면 0 으로 리셋").isEqualTo(0L);
        assertThat(MovementTicker.nextCatchUpStreak(5L, true)).as("catch-up 이면 1 증가").isEqualTo(6L);
        assertThat(MovementTicker.exceedsMaxCatchUp(20L)).as("정확히 20 은 아직 넘지 않았다").isFalse();
        assertThat(MovementTicker.exceedsMaxCatchUp(21L)).as("21 부터 넘는다").isTrue();
    }

    @Test
    @DisplayName("runTick: catch-up 이 MAX_CATCH_UP_TICKS(20) 를 넘겨 연속되면 21 번째부터는 방 tick"
            + " 자체를 건너뛴다(drain 없음 — GC/정지 뒤 수천 틱 backlog 가 틱 스레드를 가두지 않는다,"
            + " 2246 보완13)")
    void runTickSkipsEntirelyAfterMaxCatchUpStreak() {
        MovementRooms rooms = new MovementRooms(new NoopListener(), new SimpleMeterRegistry());
        MovementTicker ticker = new MovementTicker(rooms, new SimpleMeterRegistry());
        UUID islandId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        ticker.runTick(); // 1 회차 — previous==0, catch-up 아님(streak 0).
        for (int i = 0; i < 20; i++) {
            ticker.runTick(); // catch-up 1~20 회 — 아직 MAX_CATCH_UP_TICKS 를 넘지 않아 방은 그대로 틱 받는다.
        }

        rooms.join(islandId, userId, "s1"); // 21 번째 catch-up 직전에 큐에 쌓인다.
        ticker.runTick(); // catch-up 21 번째 — 이번엔 통째로 건너뛰어야 한다.

        assertThat(ticker.skippedTickCount()).as("21 번째 catch-up 1 회가 건너뛰어졌다").isEqualTo(1L);
        assertThat(actorIn(rooms.roomFor(islandId).fullStateOf(), userId))
                .as("방 tick(drain) 자체가 안 돌아 join 이 아직 반영되지 않았어야 한다").isNull();
    }
}

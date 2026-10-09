package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.Cell;
import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.NavJsonLoader;
import com.oneorthree.realtime.movement.nav.Pathfinder.PathResult;
import com.oneorthree.realtime.movement.nav.WorldCoords;
import com.oneorthree.realtime.movement.nav.WorldPoint;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.assertj.core.data.Offset;

import java.io.ByteArrayInputStream;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.LongSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link RoomRuntime} 의 경로 탐색·토큰 버킷·세션 교체·퇴장 위치 기억·스냅샷 발행 규칙 — 네트워크(Spring/STOMP)
 * 없이 직접 생성해 돈다(티켓 2246 완료 조건 2·3, 계약 §4, decisions N6·N8·N11·N15·N20·N22·N23).
 */
class RoomRuntimeTest {

    private static final UUID ISLAND = UUID.randomUUID();
    private static final Offset<Double> EPS = Offset.offset(1e-9);

    /**
     * FullState 가 계약 정밀도(0.01 world unit)로 반올림해 나가면서(codex P2, 2246 보완9) 생기는 최대 오차 —
     * 아직 도착 전(격자에 안 걸리는) 중간 위치를 수식으로 유도한 값과 비교하는 테스트는 EPS 대신 이 여유를
     * 써야 한다. 도착 위치는 항상 goal 에 정확히 스냅되므로 이 반올림의 영향을 받지 않는다.
     */
    private static final Offset<Double> ROUNDING_EPS = Offset.offset(0.0051);

    // ── 테스트 보조 ──────────────────────────────────────────────────────

    /** onEvent/onSnapshot 을 그냥 쌓아 두는 Listener — 단언은 테스트가 직접 한다. */
    private static final class RecordingListener implements RoomRuntime.Listener {
        private record Received(MovementEvent event, Target target) {
        }

        private final List<Received> events = new ArrayList<>();
        final List<MovementEvent.Snapshot> snapshots = new ArrayList<>();

        @Override
        public void onEvent(UUID islandId, MovementEvent event, Target target) {
            events.add(new Received(event, target));
        }

        @Override
        public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
            snapshots.add(snapshot);
        }

        <T extends MovementEvent> List<T> of(Class<T> type) {
            List<T> out = new ArrayList<>();
            for (Received r : events) {
                if (type.isInstance(r.event())) {
                    out.add(type.cast(r.event()));
                }
            }
            return out;
        }

        int eventCount() {
            return events.size();
        }

        Target targetOf(MovementEvent event) {
            for (Received r : events) {
                if (r.event() == event) {
                    return r.target();
                }
            }
            return null;
        }
    }

    /**
     * 첫 onEvent 콜백에서만 던지는 Listener(codex P1, 2246 보완8) — {@code drain()} 의 배치 루프가
     * 예외를 삼키고 나머지 명령을 계속 처리하는지 호출 횟수로 검증한다.
     */
    private static final class ThrowingOnFirstEventListener implements RoomRuntime.Listener {
        int onEventCallCount;

        @Override
        public void onEvent(UUID islandId, MovementEvent event, Target target) {
            onEventCallCount++;
            if (onEventCallCount == 1) {
                throw new RuntimeException("전송 콜백 실패 재현(codex P1, 2246 보완8)");
            }
        }

        @Override
        public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        }
    }

    /** cols×rows 전부 통행 가능한 합성 격자 — spawn 은 (0,0) 셀. */
    private static NavGrid openGrid(int cols, int rows) {
        return gridJson(cols, rows, '1');
    }

    /**
     * 경로를 절대 못 찾는 테스트 대체물(codex/2245 반영) — {@link RoomRuntime#processAccept} 의
     * NO_REACHABLE_GOAL 거절 분기를 검증한다. 2245 가 nav.spawns 를 로더에서 통행 칸으로 강제한
     * 뒤로는 {@code nav.Pathfinder.resolveTarget} 이 항상 출발 영역 안 최근접 셀로 보정해, 격자를
     * 아무리 비통행으로 채워도(스폰 칸까지 비통행이면 로더가 거부) 이 분기를 합성 격자만으로는
     * 재현할 수 없다 — 그래서 {@link Pathfinder} 시임을 상속해 "못 찾음" 을 직접 흉내 낸다.
     */
    private static final class UnreachablePathfinder extends Pathfinder {
        @Override
        public Optional<PathResult> find(NavGrid grid, WorldPoint from, WorldPoint to) {
            return Optional.empty();
        }
    }

    /**
     * 목적지가 지정한 좌표일 때만 {@link RuntimeException} 을 던지는 대체물(2246 보완11) —
     * {@link RoomRuntime#processAccept} 의 pathfinder 예외 경로(drain() 의 {@code guarded} 격리)를
     * 재현한다. 다른 목적지는 실제 {@code nav.Pathfinder} 로 위임해({@code super.find}) 정상 동작을
     * 유지한다 — 같은 배치의 다른 세션 intent 가 영향받지 않는지 검증할 수 있다.
     */
    private static final class ThrowingForGoalPathfinder extends Pathfinder {
        private final double throwGoalX;
        private final double throwGoalY;

        ThrowingForGoalPathfinder(double throwGoalX, double throwGoalY) {
            this.throwGoalX = throwGoalX;
            this.throwGoalY = throwGoalY;
        }

        @Override
        public Optional<PathResult> find(NavGrid grid, WorldPoint from, WorldPoint to) {
            if (to.x() == throwGoalX && to.y() == throwGoalY) {
                throw new RuntimeException("pathfinder 예외 재현(2246 보완11)");
            }
            return super.find(grid, from, to);
        }
    }

    private static NavGrid gridJson(int cols, int rows, char walk) {
        int n = cols * rows;
        StringBuilder cost = new StringBuilder();
        for (int i = 0; i < n; i++) {
            cost.append(i == 0 ? "10" : ",10");
        }
        String json = "{\"columns\":" + cols + ",\"rows\":" + rows + ",\"walkable\":\""
                + String.valueOf(walk).repeat(n) + "\",\"traversalCost\":[" + cost + "],"
                + "\"spawns\":{\"character\":{\"cx\":0,\"cy\":0}},\"entrances\":{},\"buildingCells\":{}}";
        return NavJsonLoader.load(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }

    private static RoomRuntime newRoom(NavGrid grid, MovementRules rules, RoomRuntime.Listener listener) {
        return new RoomRuntime(ISLAND, grid, new Pathfinder(), rules, listener);
    }

    /** 토큰 버킷 리필 시계를 주입하려고 쓴다(codex P2) — accept() 가 호출 스레드에서 바로 이 시계를 본다. */
    private static RoomRuntime newRoom(NavGrid grid, MovementRules rules, RoomRuntime.Listener listener,
            LongSupplier nowNanos) {
        return new RoomRuntime(ISLAND, grid, new Pathfinder(), rules, listener, nowNanos);
    }

    private static MovementEvent.ActorState actorIn(MovementEvent.FullState state, UUID userId) {
        for (MovementEvent.ActorState a : state.actors()) {
            if (a.userId().equals(userId)) {
                return a;
            }
        }
        return null;
    }

    private static MovementEvent.Entity entityIn(MovementEvent.Snapshot snapshot, UUID userId) {
        for (MovementEvent.Entity e : snapshot.entities()) {
            if (e.userId().equals(userId)) {
                return e;
            }
        }
        return null;
    }

    private static boolean isWalkable(NavGrid grid, double x, double y) {
        return grid.walkable(grid.index(WorldCoords.worldToCell(x, y)));
    }

    /** 테스트 전용 — {@code RoomRuntime.round2()} 와 같은 반올림(비공개라 복제, 계약 §0, 2246 보완14). */
    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }

    // ── 티켓 2: commandSeq 최신만 채택 · 범위 밖/NaN 거절 ────────────────

    @Test
    @DisplayName("같은 세션에 commandSeq 를 역순으로 보내도 대기 슬롯엔 가장 큰 값만 남아 PathAccepted 되고,"
            + " 덮어써진 나머지는 응답 없이 superseded 로 끝난다(codex P2, protocol §5)")
    void acceptsOnlyLatestCommandSeqWithinSameTick() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(9, 1, 5.5, 5.5));
        room.accept(userId, "s1", new MoveIntent(8, 1, 5.5, 5.5));
        room.accept(userId, "s1", new MoveIntent(7, 1, 5.5, 5.5));
        room.tick(2);

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).hasSize(1);
        assertThat(accepted.get(0).commandSeq()).isEqualTo(9L);
        assertThat(listener.targetOf(accepted.get(0))).isEqualTo(Target.ALL);

        // 대기 슬롯이 세션당 1개라 8·7 은 9 에 merge 로 덮어써진 순간 이미 사라진다 — STALE_COMMAND 거절
        // 응답이 나가던 예전과 달리, processAccept 까지 가지도 못하니 응답 자체가 없다.
        assertThat(listener.of(MovementEvent.MoveRejected.class)).isEmpty();
    }

    @Test
    @DisplayName("범위 밖 목적지는 OUT_OF_RANGE 로 거절된다")
    void rejectsGoalOutsideWorldRange() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(1, 1, 150.0, 5.0));
        room.tick(2);

        List<MovementEvent.MoveRejected> rejected = listener.of(MovementEvent.MoveRejected.class);
        assertThat(rejected).hasSize(1);
        assertThat(rejected.get(0).reason()).isEqualTo(RejectReason.OUT_OF_RANGE.name());
    }

    @Test
    @DisplayName("비유한(NaN) 목적지도 OUT_OF_RANGE 로 거절된다")
    void rejectsNonFiniteGoal() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(1, 1, Double.NaN, 5.0));
        room.tick(2);

        List<MovementEvent.MoveRejected> rejected = listener.of(MovementEvent.MoveRejected.class);
        assertThat(rejected).hasSize(1);
        assertThat(rejected.get(0).reason()).isEqualTo(RejectReason.OUT_OF_RANGE.name());
    }

    @Test
    @DisplayName("navRevision 이 다르면 NAV_REVISION_MISMATCH 로 거절된다")
    void rejectsNavRevisionMismatch() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(1, 99, 5.5, 5.5));
        room.tick(2);

        List<MovementEvent.MoveRejected> rejected = listener.of(MovementEvent.MoveRejected.class);
        assertThat(rejected).hasSize(1);
        assertThat(rejected.get(0).reason()).isEqualTo(RejectReason.NAV_REVISION_MISMATCH.name());
    }

    @Test
    @DisplayName("경로 탐색기가 경로를 못 찾으면 NO_REACHABLE_GOAL 로 거절된다")
    void rejectsWhenNoReachableGoalExists() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = new RoomRuntime(ISLAND, grid, new UnreachablePathfinder(), MovementRules.DEFAULT,
                listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5));
        room.tick(2);

        List<MovementEvent.MoveRejected> rejected = listener.of(MovementEvent.MoveRejected.class);
        assertThat(rejected).hasSize(1);
        assertThat(rejected.get(0).reason()).isEqualTo(RejectReason.NO_REACHABLE_GOAL.name());
    }

    @Test
    @DisplayName("토큰 버킷: accept 호출 시점에 21건을 연달아 보내면 burst(20) 를 넘긴 1건만 조용히 버려지고"
            + "(카운터), 대기 슬롯엔 버킷을 통과한 마지막 commandSeq 만 남아 PathAccepted 가 1회 난다(codex P2)")
    void tokenBucketDropsOneOfTwentyOneAcceptCallsAndKeepsOnlyLatestPending() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        for (long seq = 1; seq <= 21; seq++) {
            room.accept(userId, "s1", new MoveIntent(seq, 1, 5.5, 5.5));
        }
        assertThat(room.rateLimitedDropCount()).as("burst(20) 를 넘긴 1건만 버려야 한다").isEqualTo(1L);

        room.tick(2);

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).hasSize(1);
        assertThat(accepted.get(0).commandSeq())
                .as("버킷을 통과한 마지막 commandSeq(20) 만 대기 슬롯에 남는다 — 21은 버킷에서 이미 버려졌다")
                .isEqualTo(20L);
        assertThat(listener.of(MovementEvent.MoveRejected.class))
                .as("merge 로 덮어써진 1~19 는 응답 없이 superseded 로 끝난다(protocol §5)")
                .isEmpty();
    }

    @Test
    @DisplayName("토큰 버킷은 시간이 지나면 다시 채워진다 — 주입한 나노초 시계로 1초 뒤 burst 가 다시 채워진다(codex P2)")
    void tokenBucketRefillsOverInjectedClockTime() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        long[] nowNanos = {0L};
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener, () -> nowNanos[0]);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        for (long seq = 1; seq <= 20; seq++) {
            room.accept(userId, "s1", new MoveIntent(seq, 1, 5.5, 5.5)); // burst(20) 전부 소모.
        }
        room.accept(userId, "s1", new MoveIntent(21, 1, 5.5, 5.5)); // 리필 전 — 버려진다.
        assertThat(room.rateLimitedDropCount()).isEqualTo(1L);

        nowNanos[0] += 1_000_000_000L; // 1초 경과 — maxIntentsPerSec(10) 만큼 다시 채워진다.
        room.accept(userId, "s1", new MoveIntent(22, 1, 5.5, 5.5)); // 리필된 토큰으로 통과해야 한다.
        assertThat(room.rateLimitedDropCount()).as("리필 뒤 호출은 더 버려지지 않는다").isEqualTo(1L);

        room.tick(2);
        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).hasSize(1);
        assertThat(accepted.get(0).commandSeq()).isEqualTo(22L);
    }

    // ── 티켓 3: 틱당 전진 거리 · 도착 1회 ────────────────────────────────

    @Test
    @DisplayName("틱 50ms × N 뒤 위치가 speed×0.05×N 만큼 경로 위에서 전진하고, 도착은 마지막 틱에 1회만 난다")
    void advancesBySpeedTimesTickPerTickAndArrivesOnce() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 0.5)); // 스폰(0.5,0.5)에서 5칸 직선 — 경로 5.0 unit.

        double stepPerTick = MovementRules.DEFAULT.stepPerTick();
        for (int n = 1; n <= 9; n++) {
            room.tick(++tick);
            MovementEvent.ActorState state = actorIn(room.fullStateOf(), userId);
            double traveled = Math.hypot(state.x() - 0.5, state.y() - 0.5);
            // FullState 가 0.01 로 반올림해 나가므로(codex P2, 2246 보완9) 그 오차까지 허용한다.
            assertThat(traveled).as("틱 %d 뒤 누적 이동 거리", n).isCloseTo(stepPerTick * n, ROUNDING_EPS);
            assertThat(state.state()).isEqualTo(MotionState.MOVING);
        }
        assertThat(listener.of(MovementEvent.Arrived.class)).isEmpty();

        room.tick(++tick); // 10번째 틱 — 이번에 도착.
        MovementEvent.ActorState finalState = actorIn(room.fullStateOf(), userId);
        assertThat(finalState.state()).isEqualTo(MotionState.IDLE);
        assertThat(finalState.x()).isEqualTo(5.5);
        assertThat(finalState.y()).isEqualTo(0.5);
        assertThat(listener.of(MovementEvent.Arrived.class)).hasSize(1);
    }

    @Test
    @DisplayName("한 틱에 waypoint 여러 개를 지나도 남은 거리를 다음 세그먼트로 이어서 전진한다")
    void advancesAcrossMultipleWaypointsWithinOneTick() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        MovementRules bigStep = new MovementRules(2500, 1.0, 0.5, 1, "test", 10, 20, 1e-6); // stepPerTick=2.5
        RoomRuntime room = newRoom(grid, bigStep, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(7, 1, 4.5, 0.5)); // 스폰에서 4칸 직선 — waypoint 4개(index 0..3).
        room.tick(++tick); // 2.5 unit 전진 — waypoint 0,1 을 지나 세그먼트 2 중간.

        MovementEvent.Snapshot snapshot = listener.snapshots.get(listener.snapshots.size() - 1);
        MovementEvent.Entity entity = entityIn(snapshot, userId);
        assertThat(entity.x()).isCloseTo(3.0, EPS);
        assertThat(entity.y()).isCloseTo(0.5, EPS);
        assertThat(entity.segmentIndex()).isEqualTo(2);
        assertThat(entity.lastCommandSeq()).isEqualTo(7L);
        assertThat(entity.state()).isEqualTo(MotionState.MOVING);
    }

    @Test
    @DisplayName("도착 틱의 위치는 goal 과 정확히 같고, 그 뒤 틱에서도 변하지 않는다(부동소수 오버슈트 없음)")
    void arrivalPositionIsExactlyGoalAndThenFrozen() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        // 인접 셀(거리 1.0) — stepPerTick(~0.549) 의 배수가 아니라 마지막 구간이 짧게 남아 오버슈트가 나기 쉽다.
        room.accept(userId, "s1", new MoveIntent(1, 1, 1.5, 0.5));

        MovementEvent.ActorState state = null;
        for (int i = 0; i < 10 && (state == null || state.state() != MotionState.IDLE); i++) {
            room.tick(++tick);
            state = actorIn(room.fullStateOf(), userId);
        }
        assertThat(state).isNotNull();
        assertThat(state.state()).isEqualTo(MotionState.IDLE);
        // raw(반올림 전) 좌표로 오차 없이 검증한다 — round2() 를 거친 값만 보면 셀 경계에 걸리지 않는
        // goal 에서는 오버슈트가 반올림에 가려질 수 있다(2246 보완14).
        MovementEvent.Point raw = room.rawPositionOf(userId);
        assertThat(raw.x()).isEqualTo(1.5);
        assertThat(raw.y()).isEqualTo(0.5);
        assertThat(state.x()).as("송신값(FullState)은 round2(raw) 다").isEqualTo(round2(raw.x()));
        assertThat(state.y()).isEqualTo(round2(raw.y()));
        assertThat(listener.of(MovementEvent.Arrived.class)).hasSize(1);

        for (int i = 0; i < 3; i++) {
            room.tick(++tick);
            MovementEvent.Point afterRaw = room.rawPositionOf(userId);
            assertThat(afterRaw.x()).isEqualTo(1.5);
            assertThat(afterRaw.y()).isEqualTo(0.5);
        }
        assertThat(listener.of(MovementEvent.Arrived.class)).as("도착 뒤에도 Arrived 가 더 나지 않는다").hasSize(1);
    }

    @Test
    @DisplayName("segmentIndex 는 막 join 한 actor 에선 0 이다")
    void segmentIndexIsZeroForFreshlyJoinedActor() {
        NavGrid grid = openGrid(10, 10);
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener());
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        MovementEvent.Entity entity = entityIn(room.snapshotOf(), userId);
        assertThat(entity.segmentIndex()).isEqualTo(0);
    }

    @Test
    @DisplayName("segmentIndex 는 도착 후 마지막 waypoint index 로 남는다(0 으로 리셋되지 않는다)")
    void segmentIndexReportsLastWaypointIndexAfterArrival() {
        NavGrid grid = openGrid(10, 10);
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener());
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 0.5)); // 5 waypoints — index 0..4.

        for (int i = 0; i < 10; i++) {
            room.tick(++tick);
        }
        MovementEvent.Entity entity = entityIn(room.snapshotOf(), userId);
        assertThat(entity.segmentIndex()).isEqualTo(4);
    }

    @Test
    @DisplayName("Snapshot 은 MOVING 이 있는 틱 + 멈춘 뒤 1틱만 나가고 그 뒤로는 조용하다(N15)")
    void snapshotFiresWhileMovingAndOnceMoreAfterStopping() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 1.5, 0.5)); // 1칸 — 2틱이면 도착(0.5494*2 >= 1.0).

        for (int i = 0; i < 5; i++) {
            room.tick(++tick);
        }
        assertThat(listener.snapshots).as("걷는 틱 1 + 도착 틱 1 + 멈춘 뒤 1 = 3").hasSize(3);
    }

    @Test
    @DisplayName("catch-up(발행 안 함) 틱에서도 이동은 그대로 전진하고, 멈추는 틱이 false 면 그 다음"
            + " true 틱에서 Snapshot 이 \"+1\" 로 나온다(codex P2, 2246 보완4)")
    void catchUpTickSkipsSnapshotButCarriesStopObligationToNextPublishingTick() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.accept(userId, "s1", new MoveIntent(1, 1, 1.5, 0.5)); // 인접 셀 — stepPerTick(~0.549) 두 번이면 도착.

        room.tick(1, true); // join+accept 가 같은 틱에 드레인 — 첫 전진.
        assertThat(listener.snapshots).as("걷는 틱 — 발행").hasSize(1);

        room.tick(2, false); // 이 틱에 도착(멈춤)하지만 catch-up 이라 Snapshot 은 건너뛴다.
        assertThat(listener.snapshots).as("catch-up 틱은 추가 발행이 없다").hasSize(1);
        assertThat(listener.of(MovementEvent.Arrived.class))
                .as("Arrived 자체는 publishSnapshot 과 무관하게 난다").hasSize(1);

        room.tick(3, true); // 다음 발행 틱에서 미뤄진 "멈춘 뒤 +1" 이 나온다.
        assertThat(listener.snapshots).as("미뤄진 의무가 +1 로 나와야 한다").hasSize(2);

        room.tick(4, true); // 그 뒤로는 다시 조용하다.
        assertThat(listener.snapshots).as("더 이상 추가 발행이 없다").hasSize(2);
    }

    // ── N6/N20: 세션 교체 · leave ─────────────────────────────────────

    @Test
    @DisplayName("세션 교체는 위치를 유지하고 lastCommandSeq 만 0 으로 리셋한다(N6, N20)")
    void sessionReplacementKeepsPositionAndResetsCommandSeq() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(5, 1, 1.5, 0.5)); // 금방 도착해 가만히 있는 상태로 만든다.
        MovementEvent.ActorState state;
        int guard = 0;
        do {
            room.tick(++tick);
            state = actorIn(room.fullStateOf(), userId);
        } while (state.state() != MotionState.IDLE && ++guard < 10);
        MovementEvent.ActorState before = state;
        assertThat(before.state()).isEqualTo(MotionState.IDLE);
        assertThat(before.lastCommandSeq()).isEqualTo(5L);

        room.join(userId, "s2");
        room.tick(++tick);

        MovementEvent.ActorState after = actorIn(room.fullStateOf(), userId);
        assertThat(after.x()).isEqualTo(before.x());
        assertThat(after.y()).isEqualTo(before.y());
        assertThat(after.lastCommandSeq()).isEqualTo(0L);

        // 리셋이 실제로 효과가 있다 — 새 세션은 작은 commandSeq(1)도 다시 받아들여진다.
        room.accept(userId, "s2", new MoveIntent(1, 1, 2.5, 2.5));
        room.tick(++tick);
        assertThat(listener.of(MovementEvent.MoveRejected.class)).isEmpty();
    }

    @Test
    @DisplayName("같은 세션의 중복 join 은 멱등이다 — lastCommandSeq·토큰 버킷을 그대로 두고 FullState 를"
            + " 다시 보내지 않는다(codex P2, 2246 보완4)")
    void duplicateJoinFromSameSessionIsNoop() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);
        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5)); // seq 1 수락 — lastCommandSeq=1 이 된다.
        room.tick(2);
        assertThat(listener.of(MovementEvent.PathAccepted.class)).hasSize(1);

        int fullStateCountBefore = listener.of(MovementEvent.FullState.class).size();
        int bucketCountBefore = room.bucketCount();

        room.join(userId, "s1"); // 같은 세션의 중복 join(예: 재연결 재시도) — 세션 교체가 아니다.
        room.tick(3);

        assertThat(room.bucketCount()).as("중복 join 이 옛 세션의 토큰 버킷을 지우면 안 된다")
                .isEqualTo(bucketCountBefore);
        assertThat(listener.of(MovementEvent.FullState.class))
                .as("중복 join 으로 FullState(ALL) 가 추가로 나가면 안 된다").hasSize(fullStateCountBefore);

        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5)); // 이미 채택된 seq 1 을 다시 보낸다.
        room.tick(4);

        List<MovementEvent.MoveRejected> rejected = listener.of(MovementEvent.MoveRejected.class);
        assertThat(rejected).as("lastCommandSeq 가 0 으로 리셋되지 않았어야 seq 1 재전송이 거절된다").hasSize(1);
        assertThat(rejected.get(0).reason()).isEqualTo(RejectReason.STALE_COMMAND.name());
    }

    @Test
    @DisplayName("이미 다른 세션으로 교체된 뒤의 leave 는 새 세션의 actor 를 건드리지 않는다")
    void leaveOnReplacedSessionIsNoop() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);
        room.join(userId, "s2"); // 교체.
        room.tick(2);

        room.leave("s1"); // 옛 세션의 뒷북.
        room.tick(3);

        assertThat(actorIn(room.fullStateOf(), userId)).as("새 세션(s2)의 actor 가 살아 있어야 한다").isNotNull();

        room.accept(userId, "s2", new MoveIntent(1, 1, 2.5, 2.5)); // s2 는 여전히 멀쩡히 동작한다.
        room.tick(4);
        assertThat(listener.of(MovementEvent.MoveRejected.class)).isEmpty();
    }

    @Test
    @DisplayName("leave 는 그 세션의 actor 를 지우고 FullState 를 방 전원에 다시 보낸다(N6)")
    void leaveRemovesActorAndBroadcastsFullState() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);
        assertThat(actorIn(room.fullStateOf(), userId)).isNotNull();

        room.leave("s1");
        room.tick(2);

        assertThat(actorIn(room.fullStateOf(), userId)).isNull();
        List<MovementEvent.FullState> fullStates = listener.of(MovementEvent.FullState.class);
        MovementEvent.FullState last = fullStates.get(fullStates.size() - 1);
        assertThat(last.actors()).isEmpty();
        assertThat(listener.targetOf(last)).isEqualTo(Target.ALL);
    }

    @Test
    @DisplayName("거절된 intent 도(STALE_COMMAND 제외) lastCommandSeq 를 옮긴다 — 거절도 그 순번의 처리"
            + " 종료 상태라 FullState 는 마지막으로 \"처리\"된(수락이든 거절이든) 번호를 보여준다"
            + "(codex PR 리뷰, 2246 보완11 — commandSeq 단조 증가)")
    void lastCommandSeqAdvancesOnRejectedIntentsToo() {
        NavGrid grid = openGrid(10, 10);
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener());
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(5, 1, 500.0, 500.0)); // 범위 밖 — OUT_OF_RANGE 거절.
        room.tick(2);
        assertThat(actorIn(room.fullStateOf(), userId).lastCommandSeq())
                .as("OUT_OF_RANGE 거절도 처리 순번에 반영된다 — 단조 증가를 보장한다").isEqualTo(5L);

        room.accept(userId, "s1", new MoveIntent(6, 1, 5.5, 5.5)); // 유효 — 채택.
        room.tick(3);
        assertThat(actorIn(room.fullStateOf(), userId).lastCommandSeq()).isEqualTo(6L);
    }

    @Test
    @DisplayName("거절된 commandSeq 뒤에 더 작은(옛) commandSeq 가 뒷북으로 오면 STALE_COMMAND 로 밀려"
            + " 위치를 바꾸지 못한다 — 거절도 단조 증가 순번의 종료 상태이기 때문이다"
            + "(codex PR 리뷰, 2246 보완11)")
    void rejectedCommandSeqBlocksEarlierLateArrivingCommandSeqAsStale() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(5, 1, 500.0, 500.0)); // seq 5, 범위 밖 — OUT_OF_RANGE 거절.
        room.tick(2);
        MovementEvent.ActorState afterReject = actorIn(room.fullStateOf(), userId);
        assertThat(afterReject.lastCommandSeq()).isEqualTo(5L);
        double xAfterReject = afterReject.x();
        double yAfterReject = afterReject.y();

        room.accept(userId, "s1", new MoveIntent(4, 1, 5.5, 5.5)); // seq 4 — 네트워크 뒷북으로 늦게 도착.
        room.tick(3);
        // listener 는 누적이다 — seq 5 의 OUT_OF_RANGE 거절(1건) 이 이미 들어 있으니 이번에 2건이어야 한다.
        List<MovementEvent.MoveRejected> rejected = listener.of(MovementEvent.MoveRejected.class);
        assertThat(rejected).as("seq 5 OUT_OF_RANGE 거절 1건 + seq 4 STALE_COMMAND 거절 1건").hasSize(2);
        assertThat(rejected.get(1).reason())
                .as("seq 4 는 (거절이었지만 반영된) seq 5 보다 작아 STALE_COMMAND 로 밀려야 한다")
                .isEqualTo(RejectReason.STALE_COMMAND.name());
        MovementEvent.ActorState afterStale = actorIn(room.fullStateOf(), userId);
        assertThat(afterStale.x()).as("STALE_COMMAND 로 밀려 위치가 바뀌면 안 된다").isEqualTo(xAfterReject);
        assertThat(afterStale.y()).isEqualTo(yAfterReject);

        room.accept(userId, "s1", new MoveIntent(6, 1, 5.5, 5.5)); // seq 6 — 유효하고 5 보다 크다 — 수락돼야 한다.
        room.tick(4);
        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).hasSize(1);
        assertThat(accepted.get(0).commandSeq()).isEqualTo(6L);
    }

    // ── codex P1(2246 보완8): 전송 콜백 예외가 같은 배치를 끊지 않는다 ──────

    @Test
    @DisplayName("두 사용자가 같은 틱에 join 하고 Listener 가 첫 FullState 전송에서 던져도, 틱 뒤 두"
            + " actor 모두 존재하고 두 번째 사용자의 FullState 전송도 시도된다(호출 횟수 2, codex P1, 2246 보완8)")
    void listenerExceptionOnFirstEventDoesNotDropRestOfSameBatch() {
        NavGrid grid = openGrid(10, 10);
        ThrowingOnFirstEventListener listener = new ThrowingOnFirstEventListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID user1 = UUID.randomUUID();
        UUID user2 = UUID.randomUUID();

        room.join(user1, "s1");
        room.join(user2, "s2"); // 같은 배치 — 첫 FullState 전송(user1) 에서 Listener 가 던진다.
        room.tick(1);

        assertThat(listener.onEventCallCount)
                .as("예외가 삼켜져 두 번째 사용자의 FullState 전송도 시도돼야 한다").isEqualTo(2);
        assertThat(actorIn(room.fullStateOf(), user1))
                .as("콜백 실패 전에 상태 변경이 이미 끝나 있어 actor 가 남아 있다").isNotNull();
        assertThat(actorIn(room.fullStateOf(), user2)).as("배치의 나머지 명령도 그대로 처리된다").isNotNull();
    }

    // ── codex PR 리뷰(2246 보완11): drain() 의 명령 단위 예외 격리 ──────────

    @Test
    @DisplayName("accept 배치에서 한 세션의 pathfinder 가 예외를 던져도 다른 세션의 intent 는 그대로"
            + " PathAccepted 를 받고 그 뒤 틱에서 전진한다(drain() 의 guarded 격리)")
    void pathfinderExceptionForOneSessionDoesNotBlockAnotherSessionsAccept() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = new RoomRuntime(ISLAND, grid, new ThrowingForGoalPathfinder(9.5, 9.5),
                MovementRules.DEFAULT, listener);
        UUID throwingUser = UUID.randomUUID();
        UUID okUser = UUID.randomUUID();
        room.join(throwingUser, "sa");
        room.join(okUser, "sb");
        room.tick(1);

        room.accept(throwingUser, "sa", new MoveIntent(1, 1, 9.5, 9.5)); // pathfinder.find 가 던진다.
        room.accept(okUser, "sb", new MoveIntent(1, 1, 5.5, 5.5)); // 같은 배치의 다른 세션 — 영향받으면 안 된다.
        room.tick(2); // 예외가 drain() 밖으로 새면 이 호출 자체가 테스트를 실패시킨다.

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).as("던진 세션은 응답이 없고, 정상 세션만 PathAccepted 를 받는다").hasSize(1);
        assertThat(accepted.get(0).userId()).isEqualTo(okUser);

        room.tick(3); // 한 틱 더 — 정상 세션이 실제로 전진하는지까지 본다.
        MovementEvent.ActorState okState = actorIn(room.fullStateOf(), okUser);
        assertThat(okState.state()).as("예외 세션과 무관하게 정상 세션은 계속 전진한다").isEqualTo(MotionState.MOVING);
        assertThat(okState.x()).as("실제로 전진했다(스폰 0.5 에서 벗어났다)").isNotEqualTo(0.5);

        MovementEvent.ActorState throwingState = actorIn(room.fullStateOf(), throwingUser);
        assertThat(throwingState.state()).as("던진 세션은 경로를 받지 못해 그대로 IDLE 이다")
                .isEqualTo(MotionState.IDLE);
    }

    @Test
    @DisplayName("같은 배치에 pathfinder 예외와 leave 가 함께 있어도 leave 는 그대로 처리돼 actor 가"
            + " 유령 사용자로 남지 않는다(drain() 의 guarded 격리)")
    void leaveInSameBatchAsThrowingAcceptStillRemovesActor() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = new RoomRuntime(ISLAND, grid, new ThrowingForGoalPathfinder(9.5, 9.5),
                MovementRules.DEFAULT, listener);
        UUID throwingUser = UUID.randomUUID();
        UUID okUser = UUID.randomUUID();
        UUID leavingUser = UUID.randomUUID();
        room.join(throwingUser, "sa");
        room.join(okUser, "sb");
        room.join(leavingUser, "sc");
        room.tick(1);

        room.leave("sc"); // FIFO 1차 루프에서 처리 — accept(2차, latest 드레인)보다 먼저 끝난다.
        room.accept(throwingUser, "sa", new MoveIntent(1, 1, 9.5, 9.5)); // 2차 루프에서 던진다.
        room.accept(okUser, "sb", new MoveIntent(1, 1, 5.5, 5.5));
        room.tick(2); // 예외가 drain() 밖으로 새면 이 호출 자체가 테스트를 실패시킨다.

        assertThat(actorIn(room.fullStateOf(), leavingUser))
                .as("leave 가 처리돼 유령 사용자로 남지 않는다").isNull();
        assertThat(room.departedCount()).as("퇴장 기억은 정상적으로 남는다(N23)").isEqualTo(1);
        assertThat(listener.of(MovementEvent.PathAccepted.class))
                .as("leave·예외와 무관하게 정상 세션의 accept 도 그대로 처리된다").hasSize(1);
    }

    // ── codex P2(2246 보완13): 경로 탐색 예외는 명령 번호를 소비하지 않는다 ──────

    @Test
    @DisplayName("pathfinder 예외로 응답 없이 끝난 commandSeq 는 소비되지 않아, 같은 seq 를 정상 goal 로"
            + " 재시도하면 STALE_COMMAND 가 아니라 PathAccepted 로 처리된다(2246 보완13)")
    void commandSeqSurvivesPathfinderExceptionForRetry() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = new RoomRuntime(ISLAND, grid, new ThrowingForGoalPathfinder(9.5, 9.5),
                MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(3, 1, 9.5, 9.5)); // 예외 goal — 응답 없이 끝난다.
        room.tick(2); // 예외가 drain() 밖으로 새면 이 호출 자체가 테스트를 실패시킨다.

        assertThat(listener.of(MovementEvent.PathAccepted.class)).as("예외라 응답이 전혀 없다").isEmpty();
        assertThat(listener.of(MovementEvent.MoveRejected.class)).as("예외라 거절 응답도 없다").isEmpty();
        assertThat(actorIn(room.fullStateOf(), userId).lastCommandSeq())
                .as("번호가 확정되지 않아 join 때 그대로 0 이어야 한다").isEqualTo(0L);

        room.accept(userId, "s1", new MoveIntent(3, 1, 5.5, 5.5)); // 같은 seq 3 을 정상 goal 로 재시도.
        room.tick(3);

        assertThat(listener.of(MovementEvent.MoveRejected.class)).as("재시도가 STALE_COMMAND 로 밀리면 안 된다")
                .isEmpty();
        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).as("재시도가 정상 수락돼야 한다").hasSize(1);
        assertThat(accepted.get(0).commandSeq()).isEqualTo(3L);
    }

    // ── codex P2(2246 보완13): drain() 의 FIFO — 입장 전 intent 는 입장과 함께 죽는다 ──

    @Test
    @DisplayName("같은 틱에 accept 가 join 보다 먼저 들어오면, 입장 전 intent 는 입장과 함께 죽어 새"
            + " actor 는 IDLE 로 남고 PathAccepted 가 나가지 않는다(2246 보완13)")
    void acceptBeforeJoinInSameBatchIsDiscardedWithTheJoin() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();

        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5)); // join 보다 먼저 큐에 들어간다.
        room.join(userId, "s1");
        room.tick(1);

        assertThat(listener.of(MovementEvent.PathAccepted.class))
                .as("입장 전 intent 는 적용되지 않아야 한다").isEmpty();
        MovementEvent.ActorState state = actorIn(room.fullStateOf(), userId);
        assertThat(state).isNotNull();
        assertThat(state.state()).as("새 actor 는 유령 명령 없이 IDLE 로 남는다").isEqualTo(MotionState.IDLE);
    }

    // ── N23: 퇴장 위치 기억 · 같은 셀 탭 ──────────────────────────────

    @Test
    @DisplayName("퇴장 위치 기억: 10분 안에 재입장하면 떠난 자리에서 다시 시작한다(N23)")
    void rejoinWithinTenMinutesRestoresLastPosition() {
        NavGrid grid = openGrid(10, 10);
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener());
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 1.5, 0.5));
        MovementEvent.ActorState state;
        int guard = 0;
        do {
            room.tick(++tick);
            state = actorIn(room.fullStateOf(), userId);
        } while (state.state() != MotionState.IDLE && ++guard < 10);
        double departedX = state.x();
        double departedY = state.y();
        assertThat(departedX).as("스폰과 달라야 \"떠난 자리\" 검증이 의미 있다").isNotEqualTo(0.5);

        room.leave("s1");
        room.tick(++tick);

        room.join(userId, "s2"); // 몇 틱 뒤(10분 한참 안) 재입장.
        room.tick(++tick);

        MovementEvent.ActorState rejoined = actorIn(room.fullStateOf(), userId);
        assertThat(rejoined.x()).isEqualTo(departedX);
        assertThat(rejoined.y()).isEqualTo(departedY);
    }

    @Test
    @DisplayName("퇴장 위치 기억: 10분이 지나면 스폰에서 다시 시작한다(N23)")
    void rejoinAfterTenMinutesSpawnsAgain() {
        NavGrid grid = openGrid(10, 10);
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener());
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 1.5, 0.5));
        MovementEvent.ActorState state;
        int guard = 0;
        do {
            room.tick(++tick);
            state = actorIn(room.fullStateOf(), userId);
        } while (state.state() != MotionState.IDLE && ++guard < 10);
        assertThat(state.x()).isNotEqualTo(0.5);

        room.leave("s1");
        room.tick(++tick);
        long leftAtTick = tick;

        room.join(userId, "s2");
        room.tick(leftAtTick + MovementRules.DEFAULT.ticksFor(10 * 60 * 1000L) + 1); // 10분 창을 지난 뒤.

        MovementEvent.ActorState rejoined = actorIn(room.fullStateOf(), userId);
        assertThat(rejoined.x()).isEqualTo(0.5);
        assertThat(rejoined.y()).isEqualTo(0.5);
    }

    @Test
    @DisplayName("같은 셀 탭: PathAccepted(waypoints=[]) 뒤 같은 틱에 Arrived 가 나고 위치는 셀 중심으로 당겨지지 않는다(N23)")
    void sameCellTapAcceptsEmptyPathAndArrivesWithoutSnappingToCellCenter() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        MovementRules slow = new MovementRules(1000, 0.3, 0.5, 1, "test", 10, 20, 1e-6); // stepPerTick=0.3
        RoomRuntime room = newRoom(grid, slow, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 9.5, 0.5)); // 먼 목적지 — 중간에 멈춰 세우려는 의도.
        room.tick(++tick); // 0.3 unit 전진 → (0.8, 0.5), 셀 중심이 아니다.

        MovementEvent.ActorState mid = actorIn(room.fullStateOf(), userId);
        assertThat(mid.x()).isCloseTo(0.8, EPS);
        assertThat(mid.state()).isEqualTo(MotionState.MOVING);

        int eventsBefore = listener.eventCount();
        room.accept(userId, "s1", new MoveIntent(2, 1, 0.9, 0.9)); // mid 와 같은 셀(0,0) 안.
        room.tick(++tick);

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        MovementEvent.PathAccepted lastAccepted = accepted.get(accepted.size() - 1);
        assertThat(lastAccepted.waypoints()).isEmpty();

        List<MovementEvent.Arrived> arrived = listener.of(MovementEvent.Arrived.class);
        MovementEvent.Arrived lastArrived = arrived.get(arrived.size() - 1);
        assertThat(lastArrived.position().x()).isCloseTo(mid.x(), EPS);
        assertThat(lastArrived.position().y()).isCloseTo(mid.y(), EPS);
        assertThat(listener.eventCount()).as("PathAccepted + Arrived, 같은 틱").isEqualTo(eventsBefore + 2);
    }

    // ── 리뷰 반박 근거 3건 — 서버 actor 는 비통행 셀에 놓이지 않는다 ──────

    @Test
    @DisplayName("실제 번들 nav: 스폰에서 입구 여러 곳을 차례로 걷는 동안 매 틱 위치가 통행 셀 안에 있다(대각 구간 포함)")
    void everyTickPositionStaysOnWalkableCellAcrossRealNav() {
        NavGrid grid = NavJsonLoader.loadBundled();
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        long commandSeq = 0;
        int sampledTicks = 0;
        for (Map.Entry<String, Cell> entrance : grid.entrances().entrySet()) {
            var center = WorldCoords.cellCenter(entrance.getValue());
            room.accept(userId, "s1", new MoveIntent(++commandSeq, 1, center.x(), center.y()));
            boolean arrived = false;
            int guard = 0;
            while (!arrived && guard++ < 3000) {
                room.tick(++tick);
                sampledTicks++;
                MovementEvent.ActorState state = actorIn(room.fullStateOf(), userId);
                // raw(반올림 전) 위치로 통행 판정한다 — round2() 로 반올림한 값은 셀 경계 바로 바깥으로
                // 밀려 비통행처럼 보일 수 있다(2246 보완14).
                MovementEvent.Point raw = room.rawPositionOf(userId);
                assertThat(isWalkable(grid, raw.x(), raw.y()))
                        .as("입구 %s 로 가는 중 틱 %d raw 위치 (%f,%f) 가 비통행 셀", entrance.getKey(), tick,
                                raw.x(), raw.y())
                        .isTrue();
                assertThat(state.x()).as("송신값(FullState)은 round2(raw) 다").isEqualTo(round2(raw.x()));
                assertThat(state.y()).isEqualTo(round2(raw.y()));
                arrived = state.state() == MotionState.IDLE;
            }
            assertThat(arrived).as("입구 %s 도착 못함(가드 초과)", entrance.getKey()).isTrue();
        }
        assertThat(sampledTicks).as("최소 수백 틱 샘플").isGreaterThanOrEqualTo(200);

        boolean sawDiagonalSegment = false;
        for (MovementEvent.PathAccepted p : listener.of(MovementEvent.PathAccepted.class)) {
            MovementEvent.Point prev = p.start();
            for (MovementEvent.Point wp : p.waypoints()) {
                if (prev.x() != wp.x() && prev.y() != wp.y()) {
                    sawDiagonalSegment = true;
                }
                prev = wp;
            }
        }
        assertThat(sawDiagonalSegment).as("7개 입구로 가는 경로 중 대각 구간이 하나도 없다").isTrue();
    }

    @Test
    @DisplayName("실제 번들 nav: 입구 7곳을 왕복하는 모든 PathAccepted 선분을 0.01 간격으로 촘촘히"
            + " 샘플해도(반올림 전 raw 좌표) 매 점이 통행 셀 안이다 — 대각 구간의 네 셀 교차점 반올림까지"
            + " 결정론적으로 덮는다(2246 보완11, 틱 보폭(~0.55)에 기대 샘플하던 기존 테스트의 보완)")
    void everySampledPointAlongPathAcceptedSegmentsStaysWalkableAcrossRealNav() {
        NavGrid grid = NavJsonLoader.loadBundled();
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        var spawnCenter = WorldCoords.cellCenter(grid.spawns().get("character"));
        long commandSeq = 0;
        for (Cell entranceCell : grid.entrances().values()) {
            var entranceCenter = WorldCoords.cellCenter(entranceCell);
            // 왕복 — 스폰 → 입구 → 스폰. 반대 방향의 A* 가 타이브레이크로 다른 셀 열을 골라 대각 구간을
            // 더 다양하게 모은다(갈 때 안 쓴 대각이 올 때 나올 수 있다).
            for (var goal : List.of(entranceCenter, spawnCenter)) {
                room.accept(userId, "s1", new MoveIntent(++commandSeq, 1, goal.x(), goal.y()));
                boolean arrived = false;
                int guard = 0;
                while (!arrived && guard++ < 3000) {
                    room.tick(++tick);
                    arrived = actorIn(room.fullStateOf(), userId).state() == MotionState.IDLE;
                }
                assertThat(arrived).as("목적지 (%f,%f) 도착 못함(가드 초과)", goal.x(), goal.y()).isTrue();
            }
        }

        int sampledPoints = 0;
        for (MovementEvent.PathAccepted p : listener.of(MovementEvent.PathAccepted.class)) {
            MovementEvent.Point prev = p.start();
            for (MovementEvent.Point wp : p.waypoints()) {
                double dx = wp.x() - prev.x();
                double dy = wp.y() - prev.y();
                double length = Math.hypot(dx, dy);
                int steps = (int) Math.ceil(length / 0.01);
                for (int i = 0; i <= steps; i++) {
                    double fraction = steps == 0 ? 0.0 : Math.min(1.0, i * 0.01 / length);
                    // raw 좌표 — round2() 를 거치지 않은 보간점을 그대로 검사한다(계약 반올림 전 선분).
                    double x = prev.x() + dx * fraction;
                    double y = prev.y() + dy * fraction;
                    assertThat(isWalkable(grid, x, y))
                            .as("선분 (%f,%f)→(%f,%f) 의 %.4f 지점 (%f,%f) 가 비통행 셀", prev.x(), prev.y(),
                                    wp.x(), wp.y(), fraction, x, y)
                            .isTrue();
                    sampledPoints++;
                }
                prev = wp;
            }
        }
        assertThat(sampledPoints).as("0.01 간격 샘플이 충분히 모였다").isGreaterThanOrEqualTo(200);
    }

    @Test
    @DisplayName("실제 번들 nav: 이동 도중(셀 경계 아닌 raw 위치) 새 intent 를 받아도 매 틱 raw 좌표가"
            + " 통행 셀 안이고, 새 경로의 첫 waypoint 선분을 0.01 간격으로 샘플해도 전부 통행 셀이다"
            + "(2246 보완13 — pathfinder.find 의 from 이 셀 중심이 아닌 raw 위치로 불리는 경로)")
    void rerouteMidFlightFromRawPositionStaysWalkable() {
        NavGrid grid = NavJsonLoader.loadBundled();
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        List<Cell> entranceCells = new ArrayList<>(grid.entrances().values());
        var firstGoal = WorldCoords.cellCenter(entranceCells.get(0));
        var secondGoal = entranceCells.size() > 1
                ? WorldCoords.cellCenter(entranceCells.get(1))
                : WorldCoords.cellCenter(grid.spawns().get("character"));

        room.accept(userId, "s1", new MoveIntent(1, 1, firstGoal.x(), firstGoal.y()));
        // 도착 전 중간까지만 전진시켜 raw 위치(셀 경계 아닌 지점)에 세운다 — 틱 보폭이 셀 크기의 배수가
        // 아니라 몇 틱만 돌려도 보통 셀 중심이 아닌 위치에 멈춘다.
        MovementEvent.ActorState midFlight = null;
        for (int i = 0; i < 3; i++) {
            room.tick(++tick);
            midFlight = actorIn(room.fullStateOf(), userId);
            // raw(반올림 전) 위치로 통행 판정한다(2246 보완14) — round2() 값은 셀 경계 바로 바깥으로
            // 밀려 비통행처럼 보일 수 있다.
            MovementEvent.Point midFlightRaw = room.rawPositionOf(userId);
            assertThat(isWalkable(grid, midFlightRaw.x(), midFlightRaw.y()))
                    .as("재경로 전 전진 중 틱 %d raw 위치 (%f,%f) 가 비통행 셀", tick, midFlightRaw.x(),
                            midFlightRaw.y())
                    .isTrue();
            assertThat(midFlight.x()).as("송신값(FullState)은 round2(raw) 다").isEqualTo(round2(midFlightRaw.x()));
            assertThat(midFlight.y()).isEqualTo(round2(midFlightRaw.y()));
        }
        assertThat(midFlight.state()).as("아직 도착 전이어야 재경로 의미가 있다").isEqualTo(MotionState.MOVING);

        room.accept(userId, "s1", new MoveIntent(2, 1, secondGoal.x(), secondGoal.y())); // 이동 도중 새 intent.
        room.tick(++tick); // drain() 의 processAccept 가 raw 위치(from)에서 A* 를 다시 돈다.

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        MovementEvent.PathAccepted reroute = accepted.get(accepted.size() - 1);
        assertThat(reroute.commandSeq()).as("재경로 intent 가 실제로 채택됐다").isEqualTo(2L);
        assertThat(reroute.waypoints()).as("다른 목적지라 waypoints 가 있어야 한다").isNotEmpty();

        boolean arrived = false;
        int guard = 0;
        while (!arrived && guard++ < 3000) {
            room.tick(++tick);
            MovementEvent.ActorState state = actorIn(room.fullStateOf(), userId);
            // raw(반올림 전) 위치로 통행 판정한다(2246 보완14).
            MovementEvent.Point raw = room.rawPositionOf(userId);
            assertThat(isWalkable(grid, raw.x(), raw.y()))
                    .as("재경로 뒤 틱 %d raw 위치 (%f,%f) 가 비통행 셀", tick, raw.x(), raw.y()).isTrue();
            assertThat(state.x()).as("송신값(FullState)은 round2(raw) 다").isEqualTo(round2(raw.x()));
            assertThat(state.y()).isEqualTo(round2(raw.y()));
            arrived = state.state() == MotionState.IDLE;
        }
        assertThat(arrived).as("재경로 목적지 도착 못함(가드 초과)").isTrue();

        // 새 경로의 첫 waypoint 선분 — raw 위치에서 출발하는 유일한 구간이라 0.01 간격으로 촘촘히 샘플한다.
        MovementEvent.Point start = reroute.start();
        MovementEvent.Point firstWaypoint = reroute.waypoints().get(0);
        double dx = firstWaypoint.x() - start.x();
        double dy = firstWaypoint.y() - start.y();
        double length = Math.hypot(dx, dy);
        int steps = (int) Math.ceil(length / 0.01);
        for (int i = 0; i <= steps; i++) {
            double fraction = steps == 0 ? 0.0 : Math.min(1.0, i * 0.01 / length);
            double x = start.x() + dx * fraction;
            double y = start.y() + dy * fraction;
            assertThat(isWalkable(grid, x, y))
                    .as("재경로 첫 선분의 %.4f 지점 (%f,%f) 가 비통행 셀", fraction, x, y).isTrue();
        }
    }

    @Test
    @DisplayName("MoveIntent 은 commandSeq·navRevision·goalX·goalY 네 필드뿐이다 — 출발점을 클라이언트가 보낼 수 없다")
    void moveIntentHasNoClientSuppliedStartField() {
        RecordComponent[] components = MoveIntent.class.getRecordComponents();
        String[] names = Arrays.stream(components).map(RecordComponent::getName).toArray(String[]::new);
        assertThat(names).containsExactly("commandSeq", "navRevision", "goalX", "goalY");
    }

    @Test
    @DisplayName("PathAccepted.start 는 매번 서버가 기록한 actor 의 현재 위치다(intent 에는 출발점 필드가 없다)")
    void pathAcceptedStartIsAlwaysServerTrackedPosition() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5));
        for (int i = 0; i < 5; i++) {
            room.tick(++tick); // 도착 전 — 아직 MOVING 인 어중간한 위치에 세운다.
        }
        MovementEvent.ActorState mid = actorIn(room.fullStateOf(), userId);
        assertThat(mid.state()).isEqualTo(MotionState.MOVING);

        room.accept(userId, "s1", new MoveIntent(2, 1, 8.5, 2.5));
        room.tick(++tick);

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).hasSize(2);
        MovementEvent.PathAccepted second = accepted.get(1);
        assertThat(second.start().x()).isEqualTo(mid.x());
        assertThat(second.start().y()).isEqualTo(mid.y());
    }

    // ── N34: FullState.ActorState.waypoints ──────────────────────────────

    @Test
    @DisplayName("FullState.ActorState.waypoints 는 MOVING 이면 지금 segmentIndex 부터 남은 waypoint 열과 같고,"
            + " IDLE 이면(막 join 했든 도착했든) 빈 리스트다(계약 §2 변경, N34)")
    void fullStateWaypointsMatchRemainingPathWhileMovingAndEmptyWhenIdle() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        MovementEvent.ActorState freshlyJoined = actorIn(room.fullStateOf(), userId);
        assertThat(freshlyJoined.waypoints()).as("아직 경로가 없는 actor 는 빈 리스트다").isEmpty();

        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 0.5)); // 스폰에서 5칸 직선 — waypoint 5개(index 0..4).
        room.tick(++tick); // 아직 도착 전(stepPerTick~0.549 < 5.0) — MOVING.

        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        List<MovementEvent.Point> fullPath = accepted.get(accepted.size() - 1).waypoints();
        MovementEvent.Entity movingEntity = entityIn(room.snapshotOf(), userId);
        MovementEvent.ActorState movingState = actorIn(room.fullStateOf(), userId);
        assertThat(movingState.state()).isEqualTo(MotionState.MOVING);
        assertThat(movingState.waypoints())
                .as("MOVING 이면 지금 segmentIndex(%d) 부터 끝까지 남은 열이어야 한다", movingEntity.segmentIndex())
                .containsExactlyElementsOf(fullPath.subList(movingEntity.segmentIndex(), fullPath.size()));

        for (int i = 0; i < 10; i++) {
            room.tick(++tick); // 도착까지 넉넉히(이 경로는 10번째 틱에 도착한다).
        }
        MovementEvent.ActorState arrivedState = actorIn(room.fullStateOf(), userId);
        assertThat(arrivedState.state()).isEqualTo(MotionState.IDLE);
        assertThat(arrivedState.waypoints()).as("도착해 IDLE 이면 빈 리스트다").isEmpty();
    }

    // ── codex P2: 만료된 퇴장 기억 정리(N23 prune) ────────────────────────

    @Test
    @DisplayName("다른 actor 가 남아 방이 살아 있어도 만료된 퇴장 기억은 틱마다 정리된다(N23 prune)")
    void departedMemoryIsPrunedEvenWhenAnotherActorKeepsRoomAlive() {
        NavGrid grid = openGrid(10, 10);
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener());
        UUID staying = UUID.randomUUID();
        UUID leaving = UUID.randomUUID();
        long tick = 0;
        room.join(staying, "stay"); // 끝까지 남아 방을 살려 둔다 — isRemovable() 이 actors 때문에 false.
        room.join(leaving, "leave");
        room.tick(++tick);

        room.leave("leave");
        room.tick(++tick);
        assertThat(room.departedCount()).as("퇴장 직후엔 기억이 남아 있다").isEqualTo(1);
        assertThat(room.isRemovable()).isFalse();

        long ticksToExpire = MovementRules.DEFAULT.ticksFor(10 * 60 * 1000L) + 1; // 10분 창을 지난 뒤.
        for (long i = 0; i < ticksToExpire; i++) {
            room.tick(++tick);
        }

        assertThat(room.departedCount()).as("만료된 퇴장 기억은 다른 actor 가 있어도 정리돼야 한다").isEqualTo(0);
        assertThat(room.isRemovable()).as("stay 세션의 actor 가 남아 있으니 방은 여전히 제거 대상이 아니다").isFalse();
    }

    // ── codex P2: 2246 보완3 — 퇴장한 세션엔 FullState 를 보내지 않는다 ────

    @Test
    @DisplayName("같은 틱에 leave(s1) 가 requestFullState(s1) 보다 먼저 큐에 들어오면(FIFO), actor 가"
            + " 이미 없으므로 퇴장한 세션엔 FullState(ONLY) 를 보내지 않는다(codex P2, 2246 보완3·보완5)")
    void doesNotSendFullStateToSessionThatLeftInSameTick() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.leave("s1"); // 먼저 큐에 들어간다 — FIFO(2246 보완5)로 requestFullState 보다 앞서 처리된다.
        room.requestFullState("s1"); // 뒷북 요청 — 처리 시점엔 이미 actor 가 없다.
        room.tick(2);

        long sentOnlyToLeftSession = listener.of(MovementEvent.FullState.class).stream()
                .filter(fs -> Target.only("s1").equals(listener.targetOf(fs)))
                .count();
        assertThat(sentOnlyToLeftSession).as("퇴장한 세션 s1 에 FullState(ONLY) 이벤트가 가면 안 된다").isZero();
    }

    @Test
    @DisplayName("leave 뒤 지연 도착한 accept 의 버킷은 departed 창(10분) 동안 남고, 창이 지나야 prune 된다"
            + "(codex P2, 2246 보완5 — 토큰 버킷이 세션이 아니라 사용자 기준이 된 뒤의 새 의미)")
    void delayedAcceptAfterLeaveKeepsBucketUntilDepartedWindowExpires() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        // 버킷 prune 이 이제 틱 수가 아니라 마지막 사용 뒤 벽시계 경과로 바뀌어(codex P1, 2246 보완8),
        // 틱만 빨리 돌리는 이 테스트도 실제 운영처럼 틱마다 시계를 tickMs 만큼 같이 전진시켜야 한다.
        long[] nowNanos = {0L};
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener, () -> nowNanos[0]);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        room.leave("s1");
        room.tick(++tick);
        assertThat(room.departedCount()).as("퇴장 직후엔 기억이 남아 있다").isEqualTo(1);

        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5)); // 퇴장 뒤 지연 도착 — accept() 가 버킷을 만든다.
        assertThat(room.bucketCount()).as("accept() 호출 시점(호출 스레드)엔 버킷이 생긴다").isEqualTo(1);

        room.tick(++tick); // processAccept 가 actor 없음을 보고 대기 intent 만 정리한다 — 버킷은 그대로.
        assertThat(room.bucketCount())
                .as("departed 창 안이라 버킷은 지워지지 않는다(재접속해도 순간 20 을 다시 받으면 안 된다)")
                .isEqualTo(1);

        long ticksToExpire = MovementRules.DEFAULT.ticksFor(10 * 60 * 1000L) + 1; // 10분 창을 지난 뒤.
        for (long i = 0; i < ticksToExpire; i++) {
            nowNanos[0] += MovementRules.DEFAULT.tickMs() * 1_000_000L; // 틱마다 벽시계도 같은 보폭으로.
            room.tick(++tick);
        }
        assertThat(room.departedCount()).isZero();
        assertThat(room.bucketCount()).as("departed 가 만료되면 버킷도 함께 prune 된다").isZero();
    }

    // ── codex P2: 2246 보완5 — 큐 드레인은 FIFO, 토큰 버킷은 사용자 기준 ────────────

    @Test
    @DisplayName("같은 틱에 leave(s1) 가 join(U, s1) 보다 먼저 큐에 들어오면(FIFO), 재입장한 actor 가"
            + " 살아남는다 — 타입별 4패스였다면 Join 패스가 먼저 돌아 멱등으로 무시되고 뒤이은 Leave"
            + " 패스가 지웠을 것이다(codex P2, 2246 보완5)")
    void sameTickLeaveThenJoinSameSessionKeepsReentryAlive() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);
        assertThat(actorIn(room.fullStateOf(), userId)).isNotNull();

        room.leave("s1"); // 앱 채널 effect 의 cleanup(UNSUBSCRIBE) — 먼저 큐에 들어간다.
        room.join(userId, "s1"); // 곧바로 재구독(SUBSCRIBE) — 같은 세션 키로 같은 틱에 들어온다.
        room.tick(2);

        assertThat(actorIn(room.fullStateOf(), userId))
                .as("FIFO 순서대로 Leave 뒤 Join 이 처리돼 재입장한 actor 가 남아 있어야 한다").isNotNull();
    }

    @Test
    @DisplayName("같은 틱에 join(U, s1) 이 leave(s1) 보다 먼저 큐에 들어와도(FIFO) 정상적인 join-후-leave"
            + " 는 그대로 actor 를 지운다(codex P2, 2246 보완5)")
    void sameTickJoinThenLeaveSameSessionStillRemovesActor() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();

        room.join(userId, "s1"); // 첫 입장.
        room.leave("s1"); // 같은 틱에 곧바로 퇴장 — 둘 다 첫 틱에 함께 드레인된다.
        room.tick(1);

        assertThat(actorIn(room.fullStateOf(), userId))
                .as("join 뒤 leave 가 FIFO 로 처리돼 actor 가 없어야 한다").isNull();
    }

    @Test
    @DisplayName("퇴장 전에 쌓인 대기 intent 는 같은 틱에 재입장한 새 actor 에 적용되지 않는다 — 새 actor 는"
            + " IDLE 로 남고, lastCommandSeq 가 0 부터 다시 시작해 그 뒤 옛 seq 보다 작은 commandSeq 도"
            + " 수락된다(codex P2, 2246 보완6)")
    void pendingIntentBeforeLeaveDoesNotApplyToReenteredActorInSameTick() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.accept(userId, "s1", new MoveIntent(5, 1, 5.5, 5.5)); // 퇴장 전 대기 슬롯에 쌓인 옛 명령.
        room.leave("s1");
        room.join(userId, "s1"); // 같은 세션 키로 같은 틱에 재입장.
        room.tick(2);

        MovementEvent.ActorState reentered = actorIn(room.fullStateOf(), userId);
        assertThat(reentered).as("재입장한 actor 가 있어야 한다").isNotNull();
        assertThat(reentered.state()).as("옛 대기 intent 가 적용되면 안 된다 — IDLE 로 남아야 한다")
                .isEqualTo(MotionState.IDLE);
        assertThat(reentered.lastCommandSeq()).as("아직 아무 명령도 채택되지 않았다").isZero();
        assertThat(listener.of(MovementEvent.PathAccepted.class))
                .as("재입장 틱에 옛 명령의 PathAccepted 가 나가면 안 된다").isEmpty();

        // lastCommandSeq 가 0 부터 다시 시작해, 옛 seq(5) 보다 작은 seq(1)도 STALE_COMMAND 에 밀리지 않는다.
        room.accept(userId, "s1", new MoveIntent(1, 1, 2.5, 2.5));
        room.tick(3);

        assertThat(listener.of(MovementEvent.MoveRejected.class)).as("옛 seq 5 에 밀려 거절되면 안 된다").isEmpty();
        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).as("seq 1 이 수락돼야 한다").hasSize(1);
        assertThat(accepted.get(0).commandSeq()).isEqualTo(1L);
    }

    @Test
    @DisplayName("퇴장 뒤(같은 틱 재입장 뒤) 큐에 들어온 intent 는 새 actor 에 그대로 적용된다 — leave 가"
            + " 실제로 지운 세션의 옛 대기만 지워지고, 그 뒤에 쌓인 intent 는 살아남는다(codex P2 7라운드,"
            + " 2246 보완7 — 명령 큐 FIFO 로 통합한 뒤의 회귀)")
    void intentQueuedAfterLeaveInSameTickAppliesToReenteredActor() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        room.join(userId, "s1");
        room.tick(1);

        room.leave("s1"); // 먼저 큐에 들어간다(FIFO) — 옛 actor 를 지우고 그 세션의 대기도 지운다.
        room.join(userId, "s1"); // 같은 세션 키로 같은 틱에 재입장 — 새 actor 가 만들어진다.
        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 5.5)); // leave 뒤에 큐에 들어온 intent.
        room.tick(2);

        MovementEvent.ActorState reentered = actorIn(room.fullStateOf(), userId);
        assertThat(reentered).as("재입장한 actor 가 있어야 한다").isNotNull();
        assertThat(reentered.state()).as("leave 뒤에 들어온 intent 는 새 actor 에 적용돼야 한다")
                .isEqualTo(MotionState.MOVING);
        List<MovementEvent.PathAccepted> accepted = listener.of(MovementEvent.PathAccepted.class);
        assertThat(accepted).as("새 actor 가 그 intent 로 PathAccepted 를 1회 받아야 한다").hasSize(1);
        assertThat(accepted.get(0).commandSeq()).isEqualTo(1L);
    }

    @Test
    @DisplayName("토큰 버킷은 사용자 기준이라 leave 뒤 재접속해도 순간 20 을 다시 받는 우회가 되지 않는다"
            + "(codex P2, 2246 보완5, policy §3)")
    void tokenBucketSurvivesReconnectAndStillRateLimitsSameUser() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        for (long seq = 1; seq <= 20; seq++) {
            room.accept(userId, "s1", new MoveIntent(seq, 1, 5.5, 5.5)); // burst(20) 전부 소진.
        }
        assertThat(room.rateLimitedDropCount()).isZero();

        room.leave("s1"); // 실제 퇴장(세션 교체가 아니다) — 같은 틱에 재접속도 들어온다.
        room.join(userId, "s2");
        room.tick(++tick);

        room.accept(userId, "s2", new MoveIntent(21, 1, 5.5, 5.5)); // 버킷이 비어 있으니 거절돼야 한다.
        assertThat(room.rateLimitedDropCount())
                .as("재접속해도 버킷이 유지돼 순간 20 을 다시 얻으면 안 된다").isEqualTo(1L);
        assertThat(room.bucketCount()).as("버킷은 세션이 아니라 사용자 기준으로 유지된다").isEqualTo(1);
    }

    @Test
    @DisplayName("join 없이 들어온 가짜 accept 의 버킷은 마지막 사용 뒤 10분이 지나야 지워진다 — 그 전엔"
            + " 매 틱 prune 에 지워져 burst(20) 를 다시 받는 우회가 되면 안 된다(codex P1, 2246 보완8)")
    void bucketFromAcceptWithoutJoinSurvivesUntilTenMinutesSinceLastUse() {
        NavGrid grid = openGrid(10, 10);
        long[] nowNanos = {0L};
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener(), () -> nowNanos[0]);
        UUID ghostUserId = UUID.randomUUID();

        for (long seq = 1; seq <= 20; seq++) {
            room.accept(ghostUserId, "s9", new MoveIntent(seq, 1, 5.5, 5.5)); // join 없는 세션 — burst 전부 소진.
        }
        assertThat(room.bucketCount()).as("accept() 호출 시점엔 버킷이 생긴다").isEqualTo(1);

        room.tick(1);
        assertThat(room.bucketCount())
                .as("마지막 사용 뒤 10분이 안 지났으면 actor·departed 가 없어도 버킷이 살아 있어야 한다")
                .isEqualTo(1);

        room.accept(ghostUserId, "s9", new MoveIntent(21, 1, 5.5, 5.5)); // burst(20) 를 넘겨 거절돼야 한다.
        assertThat(room.rateLimitedDropCount())
                .as("매 틱 prune 으로 버킷이 지워졌다면 이 호출은 통과했을 것이다").isEqualTo(1L);

        nowNanos[0] += 10 * 60 * 1_000_000_000L + 1; // DEPARTED_MEMORY_MS(10분)를 넘긴다.
        room.tick(2);

        assertThat(room.bucketCount()).as("마지막 사용 뒤 10분이 지나면 버킷도 prune 된다").isZero();
    }

    @Test
    @DisplayName("join 없이 들어온 가짜 accept 의 버킷이 남아 있는 동안은 isRemovable() 이 false 다 — 10분"
            + " 지나 버킷까지 prune 돼야 true 가 된다(codex P2, 2246 보완10 — MovementRooms 는 시계를 주입받지"
            + " 않아 Ticker 조합 경로는 이 RoomRuntime 단위 검증으로 대체한다)")
    void isRemovableStaysFalseWhileGhostBucketAliveAndTrueAfterTenMinutePrune() {
        NavGrid grid = openGrid(10, 10);
        long[] nowNanos = {0L};
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener(), () -> nowNanos[0]);
        UUID ghostUserId = UUID.randomUUID();

        for (long seq = 1; seq <= 20; seq++) {
            room.accept(ghostUserId, "s9", new MoveIntent(seq, 1, 5.5, 5.5)); // join 없는 세션 — burst 전부 소진.
        }
        room.tick(1); // 큐는 비지만(적용받을 actor 가 없다) 소진된 버킷은 그대로 남는다.

        assertThat(room.isRemovable())
                .as("버킷이 남아 있는데 지우면 다음 accept 가 새 방의 가득 찬 burst(20)를 다시 받는다(codex P2)")
                .isFalse();

        room.accept(ghostUserId, "s9", new MoveIntent(21, 1, 5.5, 5.5)); // burst(20) 를 넘겨 거절돼야 한다.
        assertThat(room.rateLimitedDropCount()).as("버킷이 이어졌다면 21번째 accept 는 거절된다").isEqualTo(1L);

        nowNanos[0] += 10 * 60 * 1_000_000_000L + 1; // DEPARTED_MEMORY_MS(10분)를 넘긴다.
        room.tick(2);

        assertThat(room.bucketCount()).as("마지막 사용 뒤 10분이 지나면 버킷도 prune 된다").isZero();
        assertThat(room.isRemovable()).as("버킷까지 비었으니 방은 다시 제거 대상이 된다").isTrue();
    }

    @Test
    @DisplayName("세션 교체(leave 없는 재접속)는 버킷 수를 바꾸지 않고 소진 상태를 그대로 이어간다"
            + "(codex P2, 2246 보완5)")
    void sessionReplacementKeepsBucketAndItsConsumedState() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);

        for (long seq = 1; seq <= 20; seq++) {
            room.accept(userId, "s1", new MoveIntent(seq, 1, 5.5, 5.5)); // burst(20) 전부 소진.
        }
        assertThat(room.bucketCount()).isEqualTo(1);

        room.join(userId, "s2"); // 세션 교체 — actor 는 leave 없이 그대로 살아 있다.
        room.tick(++tick);

        assertThat(room.bucketCount()).as("세션 교체는 버킷 수를 바꾸지 않는다").isEqualTo(1);

        room.accept(userId, "s2", new MoveIntent(21, 1, 5.5, 5.5)); // 소진된 버킷 그대로 — 거절돼야 한다.
        assertThat(room.rateLimitedDropCount())
                .as("교체가 버킷을 리셋했다면 이 호출은 통과했을 것이다").isEqualTo(1L);
    }

    // ── codex 프리-PR 12라운드 P2(2246 보완14): accept 의 compute 와 prune 의 computeIfPresent 원자화 ──

    @Test
    @DisplayName("만료 직전 버킷을 accept 로 되살린 직후 같은 now 로 prune(틱) 해도 지워지지 않는다 — 판정과"
            + " 제거를 같은 키의 compute 안에서 한 번에 하는 원자화 보호(2246 보완14). 실제 두 스레드 경합"
            + " 재현은 Bucket 이 private final 이라 후크를 심을 수 없어 결정적으로 쓸 수 없다 — 단일"
            + " 스레드 검증으로 대체한다(보고 참고)")
    void bucketTouchedByAcceptSurvivesImmediatePruneAtTheSameClockValue() {
        NavGrid grid = openGrid(10, 10);
        long[] nowNanos = {0L};
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, new RecordingListener(), () -> nowNanos[0]);
        UUID ghostUserId = UUID.randomUUID();

        room.accept(ghostUserId, "s9", new MoveIntent(1, 1, 5.5, 5.5)); // 버킷 생성 — lastTouchedNanos=0.
        assertThat(room.bucketCount()).isEqualTo(1);

        nowNanos[0] += 10 * 60 * 1_000_000_000L + 1; // DEPARTED_MEMORY_MS(10분)를 넘겨 — 안 건드리면 다음 prune 이 지운다.
        room.accept(ghostUserId, "s9", new MoveIntent(2, 1, 5.5, 5.5)); // 같은 now 에 되살린다 — lastTouchedNanos=now.
        room.tick(1); // 같은 now 로 바로 prune — 방금 되살린 버킷을 지우면 안 된다.

        assertThat(room.bucketCount())
                .as("방금 compute 로 되살린 버킷은 같은 now 의 prune(computeIfPresent) 에 지워지면 안 된다")
                .isEqualTo(1);
    }

    // ── codex P2: 2246 보완9 — 밖으로 나가는 좌표는 전부 계약 정밀도(0.01) ────────

    @Test
    @DisplayName("한 틱 전진해 0.01 격자에 맞지 않는 위치가 된 actor 에 대해, 그 틱의 Snapshot 좌표와"
            + " 재동기화(새 세션 requestFullState)의 FullState 좌표가 서로 같고 둘 다 계약 정밀도(0.01,"
            + " ×100 이 정수)다(codex P2, 2246 보완9)")
    void snapshotAndResyncedFullStateReportSameRoundedCoordinateAfterOneTickOfMovement() {
        NavGrid grid = openGrid(10, 10);
        RecordingListener listener = new RecordingListener();
        RoomRuntime room = newRoom(grid, MovementRules.DEFAULT, listener);
        UUID userId = UUID.randomUUID();
        long tick = 0;
        room.join(userId, "s1");
        room.tick(++tick);
        room.accept(userId, "s1", new MoveIntent(1, 1, 5.5, 0.5)); // 먼 목적지 — stepPerTick(~0.549)만 전진.
        room.tick(++tick); // PathAccepted + 한 틱 전진(도착 전) — 0.01 격자에 안 걸려 반올림 차이가 드러난다.

        MovementEvent.Snapshot snapshot = listener.snapshots.get(listener.snapshots.size() - 1);
        MovementEvent.Entity moving = entityIn(snapshot, userId);
        assertThat(moving.state()).as("아직 도착 전이어야 분수 좌표로 반올림 차이를 검증할 수 있다")
                .isEqualTo(MotionState.MOVING);

        room.join(userId, "s2"); // 재접속(세션 교체) — 위치는 유지된다(N6/N20).
        room.requestFullState("s2"); // 재동기화 요청 — 같은 배치(FIFO)로 join 뒤, 이번 틱 전진보다 먼저 처리된다.
        room.tick(++tick);

        List<MovementEvent.FullState> fullStates = listener.of(MovementEvent.FullState.class);
        MovementEvent.FullState resynced = fullStates.stream()
                .filter(fs -> Target.only("s2").equals(listener.targetOf(fs)))
                .reduce((first, last) -> last)
                .orElseThrow();
        MovementEvent.ActorState resyncedActor = actorIn(resynced, userId);

        assertThat(resyncedActor.x()).as("재동기화 FullState 와 바로 앞 Snapshot 의 x 가 같아야 한다")
                .isEqualTo(moving.x());
        assertThat(resyncedActor.y()).as("재동기화 FullState 와 바로 앞 Snapshot 의 y 가 같아야 한다")
                .isEqualTo(moving.y());
        assertThat(Math.round(moving.x() * 100) / 100.0).as("Snapshot x 가 이미 계약 정밀도(0.01)다")
                .isEqualTo(moving.x());
        assertThat(Math.round(moving.y() * 100) / 100.0).as("Snapshot y 가 이미 계약 정밀도(0.01)다")
                .isEqualTo(moving.y());
    }
}

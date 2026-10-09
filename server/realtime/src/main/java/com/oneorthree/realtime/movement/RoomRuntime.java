package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.Cell;
import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.Pathfinder.PathResult;
import com.oneorthree.realtime.movement.nav.WorldCoords;
import com.oneorthree.realtime.movement.nav.WorldPoint;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * 방(섬) 하나의 이동 상태 — 경로 탐색·actor 위치·틱 전진을 네트워크 없이 담당한다(계약 §4).
 *
 * <p><b>단일 작성자 = 틱 스레드.</b> {@link #join}·{@link #leave}·{@link #accept}·
 * {@link #requestFullState}·{@link #applyLayout} 은 모두 다른 스레드(STOMP 인바운드)에서 불려도
 * 안전하도록 <b>큐에 넣기만</b> 하고, 실제 처리는 {@link #tick} 이 큐를 드레인할 때 한 스레드에서만
 * 일어난다 — 그래서 {@link Actor} 와 아래 맵들에 동기화가 없다.
 */
public final class RoomRuntime {

    private static final Logger LOG = LoggerFactory.getLogger(RoomRuntime.class);

    /** 퇴장 위치 기억 창(N23) — 10분. */
    private static final long DEPARTED_MEMORY_MS = 10 * 60 * 1000L;

    private final UUID islandId;
    private final NavGrid nav;
    private final Pathfinder pathfinder;
    private final MovementRules rules;
    private final Listener listener;
    private final ConcurrentLinkedQueue<Command> queue = new ConcurrentLinkedQueue<>();

    // 아래 셋은 틱 스레드만 만진다(단일 작성자) — 그래서 평범한 Map 이다.
    private final Map<UUID, Actor> actors = new LinkedHashMap<>();
    private final Map<String, UUID> sessionToUser = new HashMap<>();
    private final Map<UUID, Departed> departed = new HashMap<>();

    private long serverTick;
    private long layoutRevision;
    private boolean lastTickHadMoving;

    public RoomRuntime(UUID islandId, NavGrid nav, Pathfinder pathfinder, MovementRules rules, Listener listener) {
        this.islandId = islandId;
        this.nav = nav;
        this.pathfinder = pathfinder;
        this.rules = rules;
        this.listener = listener;
    }

    public void join(UUID userId, String sessionKey) {
        queue.add(new Join(userId, sessionKey));
    }

    public void leave(String sessionKey) {
        queue.add(new Leave(sessionKey));
    }

    public void accept(String sessionKey, MoveIntent intent) {
        queue.add(new Accept(sessionKey, intent));
    }

    /** 2247 이 구독 직후에 쓴다 — 그 세션에만 FullState(ONLY). */
    public void requestFullState(String sessionKey) {
        queue.add(new RequestFullState(sessionKey));
    }

    /** 1단계는 레이아웃 버전을 기록만 한다 — 통행 칸은 바뀌지 않는다(N11). */
    public void applyLayout(long newLayoutRevision) {
        queue.add(new ApplyLayout(newLayoutRevision));
    }

    /**
     * 한 틱 처리: ① 큐 드레인(join → leave → accept → applyLayout → requestFullState 순) ② MOVING
     * actor 전진 ③ 도착 처리(경로당 1회) ④ 스냅샷(MOVING 이 있었거나 바로 전 틱까지 있었으면, N15)
     * ⑤ serverTick 저장.
     */
    public void tick(long tickNumber) {
        this.serverTick = tickNumber;
        drain();
        boolean movingNow = advanceMovementAndReportMoving();
        if (movingNow || lastTickHadMoving) {
            listener.onSnapshot(islandId, snapshotOf());
        }
        lastTickHadMoving = movingNow;
        pruneExpiredDeparted();
    }

    /**
     * Ticker 가 빈 방을 지우려고 쓴다 — actors·명령 큐·퇴장 기억(N23) 이 전부 비어야 한다(codex P1/P2).
     * 큐까지 보는 이유: actors 만 보면 "지우기로 판단한 순간"과 "실제로 지우는 순간" 사이에 다른 스레드의
     * {@code roomFor(...).join(...)} 이 큐에 들어와도 그대로 지워버려 입장이 유실된다. departed 까지 보는
     * 이유: 마지막 퇴장자의 위치 기억이 방과 함께 사라지면 10분 안 재입장 복원(N23)이 깨진다.
     */
    boolean isRemovable() {
        return actors.isEmpty() && queue.isEmpty() && departed.isEmpty();
    }

    /** 패키지 전용 — 테스트용. 지금 기억 중인 퇴장 인원 수(N23). */
    int departedCount() {
        return departed.size();
    }

    // ── 큐 드레인 ────────────────────────────────────────────────────────

    private void drain() {
        List<Command> batch = new ArrayList<>();
        for (Command c = queue.poll(); c != null; c = queue.poll()) {
            batch.add(c);
        }
        for (Command c : batch) {
            if (c instanceof Join j) {
                processJoin(j);
            }
        }
        for (Command c : batch) {
            if (c instanceof Leave l) {
                processLeave(l);
            }
        }
        processAccepts(batch);
        for (Command c : batch) {
            if (c instanceof ApplyLayout a) {
                processApplyLayout(a);
            }
        }
        for (Command c : batch) {
            if (c instanceof RequestFullState r) {
                processRequestFullState(r);
            }
        }
    }

    private void processJoin(Join cmd) {
        Actor actor = actors.get(cmd.userId());
        if (actor == null) {
            MovementEvent.Point spawn = spawnOrDepartedPosition(cmd.userId());
            actor = new Actor(cmd.userId(), cmd.sessionKey(), spawn.x(), spawn.y(), serverTick, rules.intentBurst());
            actors.put(cmd.userId(), actor);
        } else {
            // 두 번째 세션이 교체 — 위치·경로는 유지, 명령 번호만 새 세션 기준으로 리셋(N6, N20).
            actor.sessionKey = cmd.sessionKey();
            actor.lastCommandSeq = 0;
        }
        sessionToUser.put(cmd.sessionKey(), cmd.userId());
        listener.onEvent(islandId, fullStateOf(), Target.ALL);
    }

    private void processLeave(Leave cmd) {
        UUID userId = sessionToUser.remove(cmd.sessionKey());
        if (userId == null) {
            return;
        }
        Actor actor = actors.get(userId);
        if (actor == null || !actor.sessionKey.equals(cmd.sessionKey())) {
            return; // 이미 다른 세션으로 교체된 뒤의 뒷북 — 그 세션의 actor 를 건드리지 않는다.
        }
        actors.remove(userId);
        departed.put(userId, new Departed(new MovementEvent.Point(actor.x, actor.y), serverTick));
        listener.onEvent(islandId, fullStateOf(), Target.ALL);
    }

    /**
     * 같은 틱에 같은 세션의 intent 가 여럿이면 <b>commandSeq 내림차순</b>으로 하나씩
     * {@link #processAccept} 에 넣는다 — 도착 순서와 무관하게 가장 큰 seq 가 먼저 lastCommandSeq 를
     * 올려, 나머지는 기존 STALE_COMMAND 비교로 자연스럽게 걸린다(티켓2, 역순으로 넣어도 최신만 채택).
     * 토큰 버킷은 각 시도마다(=accept 호출마다) 소모되므로 순서를 바꿔도 "21건에 1건 버림"은 그대로다(N8).
     */
    private void processAccepts(List<Command> batch) {
        Map<String, List<Accept>> bySession = new LinkedHashMap<>();
        for (Command c : batch) {
            if (c instanceof Accept accept) {
                bySession.computeIfAbsent(accept.sessionKey(), k -> new ArrayList<>()).add(accept);
            }
        }
        for (List<Accept> accepts : bySession.values()) {
            accepts.sort((a, b) -> Long.compare(b.intent().commandSeq(), a.intent().commandSeq()));
            for (Accept accept : accepts) {
                processAccept(accept);
            }
        }
    }

    private void processAccept(Accept cmd) {
        String sessionKey = cmd.sessionKey();
        MoveIntent intent = cmd.intent();
        Actor actor = actorFor(sessionKey);
        if (actor == null) {
            return; // 세션의 actor 없음 — 무시.
        }
        if (!consumeToken(actor)) {
            return; // 토큰 버킷 초과 — 조용히 버린다(N8).
        }
        if (intent.commandSeq() <= actor.lastCommandSeq) {
            reject(actor, sessionKey, intent.commandSeq(), RejectReason.STALE_COMMAND);
            return;
        }
        if (intent.navRevision() != rules.navRevision()) {
            reject(actor, sessionKey, intent.commandSeq(), RejectReason.NAV_REVISION_MISMATCH);
            return;
        }
        if (!WorldCoords.isInsideWorld(intent.goalX(), intent.goalY())) {
            reject(actor, sessionKey, intent.commandSeq(), RejectReason.OUT_OF_RANGE);
            return;
        }
        WorldPoint from = new WorldPoint(actor.x, actor.y);
        WorldPoint to = new WorldPoint(intent.goalX(), intent.goalY());
        Optional<PathResult> found = pathfinder.find(nav, from, to);
        if (found.isEmpty()) {
            reject(actor, sessionKey, intent.commandSeq(), RejectReason.NO_REACHABLE_GOAL);
            return;
        }
        List<MovementEvent.Point> waypoints = toWaypoints(found.get());
        MovementEvent.Point start = new MovementEvent.Point(actor.x, actor.y);
        // goal 은 탭 좌표가 아니라 서버가 확정한 도착점(보정된 마지막 waypoint, 같은 셀이면 현재 위치) — HLD 「확정 도착」.
        MovementEvent.Point goal = waypoints.isEmpty() ? start : waypoints.get(waypoints.size() - 1);
        actor.lastCommandSeq = intent.commandSeq();
        actor.pathId++;
        actor.waypoints = waypoints;
        actor.segmentIndex = 0;
        actor.state = MotionState.MOVING;
        MovementEvent.PathAccepted accepted = new MovementEvent.PathAccepted(actor.userId, actor.lastCommandSeq,
                actor.pathId, rules.navRevision(), serverTick, start, goal, rules.speed(), waypoints);
        listener.onEvent(islandId, accepted, Target.ALL);
        // waypoints 가 비어 있으면(같은 셀) advanceMovementAndReportMoving() 이 이번 틱에 바로 Arrived 를 낸다.
    }

    private void processApplyLayout(ApplyLayout cmd) {
        this.layoutRevision = cmd.layoutRevision();
        LOG.info("섬 {} 레이아웃 버전 {} 수신 — 1단계는 통행 칸을 바꾸지 않는다(N11)", islandId, cmd.layoutRevision());
    }

    private void processRequestFullState(RequestFullState cmd) {
        listener.onEvent(islandId, fullStateOf(), Target.only(cmd.sessionKey()));
    }

    private Actor actorFor(String sessionKey) {
        UUID userId = sessionToUser.get(sessionKey);
        if (userId == null) {
            return null;
        }
        Actor actor = actors.get(userId);
        return actor != null && actor.sessionKey.equals(sessionKey) ? actor : null;
    }

    private void reject(Actor actor, String sessionKey, long commandSeq, RejectReason reason) {
        MovementEvent.Point position = new MovementEvent.Point(actor.x, actor.y);
        MovementEvent.MoveRejected event = new MovementEvent.MoveRejected(actor.userId, commandSeq, reason,
                rules.navRevision(), position);
        listener.onEvent(islandId, event, Target.only(sessionKey));
    }

    private boolean consumeToken(Actor actor) {
        long elapsedTicks = serverTick - actor.lastRefillTick;
        if (elapsedTicks > 0) {
            double refill = elapsedTicks * rules.maxIntentsPerSec() * rules.tickMs() / 1000.0;
            actor.tokens = Math.min(rules.intentBurst(), actor.tokens + refill);
            actor.lastRefillTick = serverTick;
        }
        if (actor.tokens < 1.0) {
            return false;
        }
        actor.tokens -= 1.0;
        return true;
    }

    // ── 이동 ────────────────────────────────────────────────────────────

    /** @return 이번 틱에 MOVING 이던 actor 가 하나라도 있었으면 true(Snapshot 발행 조건, N15). */
    private boolean advanceMovementAndReportMoving() {
        boolean movingNow = false;
        for (Actor actor : actors.values()) {
            if (actor.state != MotionState.MOVING) {
                continue;
            }
            movingNow = true;
            if (step(actor, rules.stepPerTick())) {
                actor.state = MotionState.IDLE;
                MovementEvent.Point position = new MovementEvent.Point(actor.x, actor.y);
                MovementEvent.Arrived arrived =
                        new MovementEvent.Arrived(actor.userId, actor.pathId, serverTick, position);
                listener.onEvent(islandId, arrived, Target.ALL);
            }
        }
        return movingNow;
    }

    /** waypoint 폴리라인 위를 distance 만큼 전진. 끝에 닿으면(도착) true — 좌표는 목표에 정확히 스냅된다. */
    private boolean step(Actor actor, double distance) {
        double remaining = distance;
        while (remaining > 0 && actor.segmentIndex < actor.waypoints.size()) {
            MovementEvent.Point target = actor.waypoints.get(actor.segmentIndex);
            double dx = target.x() - actor.x;
            double dy = target.y() - actor.y;
            double segment = Math.hypot(dx, dy);
            if (segment <= remaining + rules.arriveEpsilon()) {
                actor.x = target.x();
                actor.y = target.y();
                remaining -= segment;
                actor.segmentIndex++;
            } else {
                double fraction = remaining / segment;
                actor.x += dx * fraction;
                actor.y += dy * fraction;
                remaining = 0;
            }
        }
        return actor.segmentIndex >= actor.waypoints.size();
    }

    private List<MovementEvent.Point> toWaypoints(PathResult result) {
        List<MovementEvent.Point> points = new ArrayList<>(result.cells().length);
        for (int cellIndex : result.cells()) {
            WorldPoint center = WorldCoords.cellCenter(nav.cellOf(cellIndex));
            points.add(new MovementEvent.Point(center.x(), center.y()));
        }
        return points;
    }

    private MovementEvent.Point spawnOrDepartedPosition(UUID userId) {
        Departed d = departed.remove(userId);
        if (d != null && serverTick - d.tick() <= rules.ticksFor(DEPARTED_MEMORY_MS)) {
            return d.position();
        }
        Cell spawn = nav.spawns().get("character");
        WorldPoint center = WorldCoords.cellCenter(spawn);
        return new MovementEvent.Point(center.x(), center.y());
    }

    /**
     * 만료된 퇴장 기억을 매 틱 지운다(codex P2) — {@link #isRemovable()} 이 실제로 비는 날이 오게 하는
     * 쪽이다. 건수가 최근 퇴장자 수로 자연히 작아 매 틱 비용은 무시할 만하다(ponytail: 20틱마다로
     * 나누는 추가 상태 없이 가장 단순한 쪽을 택한다).
     */
    private void pruneExpiredDeparted() {
        long window = rules.ticksFor(DEPARTED_MEMORY_MS);
        departed.values().removeIf(d -> serverTick - d.tick() > window);
    }

    // ── 스냅샷 ────────────────────────────────────────────────────────────

    /** 패키지 전용 — 테스트·Ticker 용. */
    MovementEvent.FullState fullStateOf() {
        List<MovementEvent.ActorState> states = new ArrayList<>(actors.size());
        for (Actor actor : actors.values()) {
            states.add(new MovementEvent.ActorState(actor.userId, actor.x, actor.y, actor.state, actor.pathId,
                    actor.lastCommandSeq, remainingWaypoints(actor)));
        }
        return new MovementEvent.FullState(rules.navRevision(), serverTick, rules.tickMs(), rules.speed(), states);
    }

    // IDLE 이면 늘 segmentIndex == waypoints.size() 다(막 join 해 waypoints 가 비어 있을 때도, 도착
    // 직후에도) — 그래서 분기 없이 subList 만으로 MOVING 은 남은 열, IDLE 은 빈 리스트가 그대로 나온다.
    private static List<MovementEvent.Point> remainingWaypoints(Actor actor) {
        return actor.waypoints.subList(actor.segmentIndex, actor.waypoints.size());
    }

    /** 패키지 전용 — 테스트·Ticker 용. 좌표는 소수 2자리로 반올림한다(계약 §0). */
    MovementEvent.Snapshot snapshotOf() {
        List<MovementEvent.Entity> entities = new ArrayList<>(actors.size());
        for (Actor actor : actors.values()) {
            entities.add(new MovementEvent.Entity(actor.userId, actor.pathId, round2(actor.x), round2(actor.y),
                    reportedSegmentIndex(actor), actor.state, actor.lastCommandSeq));
        }
        return new MovementEvent.Snapshot(serverTick, rules.navRevision(), entities);
    }

    private static int reportedSegmentIndex(Actor actor) {
        if (actor.waypoints.isEmpty()) {
            return 0;
        }
        return Math.min(actor.segmentIndex, actor.waypoints.size() - 1);
    }

    private static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }

    // ── 수신 대상 콜백 ──────────────────────────────────────────────────

    /** {@link RoomRuntime} 은 네트워크를 모른다 — 이벤트는 이 콜백으로만 나간다. */
    public interface Listener {

        void onEvent(UUID islandId, MovementEvent event, Target target);

        void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot);
    }

    // ── 큐 명령 ──────────────────────────────────────────────────────────

    private sealed interface Command {
    }

    private record Join(UUID userId, String sessionKey) implements Command {
    }

    private record Leave(String sessionKey) implements Command {
    }

    private record Accept(String sessionKey, MoveIntent intent) implements Command {
    }

    private record ApplyLayout(long layoutRevision) implements Command {
    }

    private record RequestFullState(String sessionKey) implements Command {
    }

    /** 퇴장 위치 기억(N23) 한 건. */
    private record Departed(MovementEvent.Point position, long tick) {
    }
}

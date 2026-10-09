package com.oneorthree.realtime.movement;

import com.oneorthree.realtime.movement.nav.Cell;
import com.oneorthree.realtime.movement.nav.NavGrid;
import com.oneorthree.realtime.movement.nav.Pathfinder.PathResult;
import com.oneorthree.realtime.movement.nav.WorldCoords;
import com.oneorthree.realtime.movement.nav.WorldPoint;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * 방(섬) 하나의 이동 상태 — 경로 탐색·actor 위치·틱 전진을 네트워크 없이 담당한다(계약 §4).
 *
 * <p><b>단일 작성자 = 틱 스레드.</b> {@link #join}·{@link #leave}·{@link #requestFullState}·
 * {@link #applyLayout}·{@link #accept} 는 모두 다른 스레드(STOMP 인바운드)에서 불려도 안전하도록
 * <b>큐에 넣기만</b> 하고, 실제 처리는 {@link #tick} 이 큐를 드레인할 때 한 스레드에서만 일어난다 —
 * 그래서 {@link Actor} 와 아래 맵들에 동기화가 없다. {@link #accept} 의 토큰 버킷 소모만 예외다
 * (codex P2, 2246 보완2) — 호출 스레드에서 바로 끝내야 폭주하는 사용자 하나가 큐에 넣는 양을 막을 수
 * 있어서, 그 버킷이 쓰는 {@link #userBuckets} 는 {@link ConcurrentHashMap} 이다. 토큰 버킷은
 * 사용자(userId) 기준이라(policy §3 「사용자당」, 2246 보완5) 세션 교체·재접속으로는 바뀌지 않는다.
 * 버킷을 통과한 intent 는 다른 명령과 똑같이 큐에 들어가고, 세션당 최신 1개로 합치는 일은
 * {@link #drain()} 이 틱마다 한 번에 한다(별도 pendingIntent 슬롯 없음, 2246 보완7).
 */
public final class RoomRuntime {

    private static final Logger LOG = LoggerFactory.getLogger(RoomRuntime.class);

    /** 퇴장 위치 기억 창(N23) — 10분. */
    private static final long DEPARTED_MEMORY_MS = 10 * 60 * 1000L;

    /**
     * {@link #DEPARTED_MEMORY_MS} 를 나노초로 — 토큰 버킷의 {@code lastTouchedNanos} 는 틱이 아니라
     * 벽시계 나노초 기준이라(codex P1, 2246 보완8) 이 변환이 필요하다.
     */
    private static final long DEPARTED_MEMORY_NANOS = DEPARTED_MEMORY_MS * 1_000_000L;

    /**
     * 메트릭을 안 보는 호출자(대부분의 테스트)가 레지스트리를 안 챙겨도 되는 기본값(2246 보완3) — 운영은
     * {@code MovementRooms} 가 실제 {@code MeterRegistry} 로 만든 Timer 를 생성자로 주입한다.
     */
    private static final Timer DEFAULT_PATHFIND_TIMER =
            Timer.builder("movement.pathfind").register(new SimpleMeterRegistry());

    private final UUID islandId;
    private final NavGrid nav;
    private final Pathfinder pathfinder;
    private final MovementRules rules;
    private final Listener listener;
    private final LongSupplier nowNanos;
    private final Timer pathfindTimer;
    private final ConcurrentLinkedQueue<Command> queue = new ConcurrentLinkedQueue<>();

    // accept() 호출 스레드(STOMP)가 틱 스레드와 동시에 건드린다(codex P2) — 그래서 이것만 ConcurrentHashMap.
    // policy §3 「사용자당 초당 10·순간 20」이라 세션이 아니라 userId 로 키를 잡는다(codex P2, 2246
    // 보완5) — 세션 교체(재접속)마다 새로 만들지 않고, actor 가 있거나 departed 에 남아 있는 동안
    // 그대로 유지된다(정리는 pruneExpiredDeparted() 끝줄).
    private final ConcurrentHashMap<UUID, Bucket> userBuckets = new ConcurrentHashMap<>();
    private final AtomicLong rateLimitedDropCount = new AtomicLong();

    // 아래 셋은 틱 스레드만 만진다(단일 작성자) — 그래서 평범한 Map 이다.
    private final Map<UUID, Actor> actors = new LinkedHashMap<>();
    private final Map<String, UUID> sessionToUser = new HashMap<>();
    private final Map<UUID, Departed> departed = new HashMap<>();

    private long serverTick;
    private long layoutRevision;
    private boolean lastTickHadMoving;

    public RoomRuntime(UUID islandId, NavGrid nav, Pathfinder pathfinder, MovementRules rules, Listener listener) {
        this(islandId, nav, pathfinder, rules, listener, System::nanoTime, DEFAULT_PATHFIND_TIMER);
    }

    /** 패키지 전용 — 토큰 버킷 리필 시계를 테스트가 주입하기 위함(codex P2, 틱 번호 대신 벽시계 나노초). */
    RoomRuntime(UUID islandId, NavGrid nav, Pathfinder pathfinder, MovementRules rules, Listener listener,
            LongSupplier nowNanos) {
        this(islandId, nav, pathfinder, rules, listener, nowNanos, DEFAULT_PATHFIND_TIMER);
    }

    /**
     * 패키지 전용 — {@code MovementRooms}(운영)가 실제 {@code MeterRegistry} 로 만든 {@code
     * movement.pathfind} Timer 를 주입한다(codex P1 반박 대응, 2246 보완3). A* 는 여전히 이 틱 스레드
     * 안에서 동기 호출된다 — 작업 풀로 옮기는 변경이 아니라 호출 수·소요 nanos 만 센다(N10, 2250 이
     * 틱 p99 판단에 쓴다).
     */
    RoomRuntime(UUID islandId, NavGrid nav, Pathfinder pathfinder, MovementRules rules, Listener listener,
            LongSupplier nowNanos, Timer pathfindTimer) {
        this.islandId = islandId;
        this.nav = nav;
        this.pathfinder = pathfinder;
        this.rules = rules;
        this.listener = listener;
        this.nowNanos = nowNanos;
        this.pathfindTimer = pathfindTimer;
    }

    public void join(UUID userId, String sessionKey) {
        queue.add(new Join(userId, sessionKey));
    }

    public void leave(String sessionKey) {
        queue.add(new Leave(sessionKey));
    }

    /**
     * 토큰 버킷(policy §3 「사용자당 초당 10·순간 20」, N8)을 호출 스레드(STOMP)에서 바로 소모한다
     * (codex P2) — 통과한 intent 만 {@link Intent} 로 큐에 들어가므로, 같은 세션이 한 틱 사이에 큐에
     * 쌓는 Intent 수도 이 버킷(사용자당 초당 10·순간 20)이 이미 묶는다(2246 보완7 — 별도
     * pendingIntent 슬롯은 더 없다). 초과하면 큐에 넣지 않고 조용히 버린다
     * ({@link #rateLimitedDropCount()}, debug 로그).
     *
     * <p>버킷은 {@code userId} 기준이다(codex P2, 2246 보완5) — 세션 기준이면 재접속마다 새
     * sessionKey 로 새 버킷이 생겨, 접속을 반복하면 매번 순간 20 개를 다시 얻는 우회가 된다. 큐에 쌓인
     * Intent 를 세션당 최신 1개로 합치는 일은 더 이상 여기서 하지 않고 {@link #drain()} 이 틱마다 한
     * 번에 한다 — 적용 대기 명령은 actor당 최신 1개뿐이라(policy §3) 나머지는 응답 없이 superseded 로
     * 끝난다(protocol §5). 이미 채택된 뒤의 명령을 또 보낸 경우의 STALE_COMMAND 응답은
     * {@link #processAccept} 가 여전히 낸다.
     */
    public void accept(UUID userId, String sessionKey, MoveIntent intent) {
        Bucket bucket = userBuckets.computeIfAbsent(userId, k -> new Bucket(rules.intentBurst(),
                nowNanos.getAsLong()));
        if (!bucket.tryConsume(nowNanos.getAsLong(), rules)) {
            rateLimitedDropCount.incrementAndGet();
            LOG.debug("사용자 {} 토큰 버킷 초과 — commandSeq={} intent 를 큐에 넣지 않고 버린다(N8)", userId,
                    intent.commandSeq());
            return;
        }
        queue.add(new Intent(sessionKey, intent));
    }

    /** 2247 이 구독 직후에 쓴다 — 그 세션에만 FullState(ONLY). */
    public void requestFullState(String sessionKey) {
        queue.add(new RequestFullState(sessionKey));
    }

    /** 1단계는 레이아웃 버전을 기록만 한다 — 통행 칸은 바뀌지 않는다(N11). */
    public void applyLayout(long newLayoutRevision) {
        queue.add(new ApplyLayout(newLayoutRevision));
    }

    /** 공개 API(Ticker·테스트) — 매번 Snapshot 을 발행하는 평범한 틱({@code tick(tickNumber, true)} 위임). */
    public void tick(long tickNumber) {
        tick(tickNumber, true);
    }

    /**
     * 한 틱 처리: ① 큐 드레인(join·leave·applyLayout·requestFullState 는 큐에 쌓인 순서(FIFO)
     * 그대로, accept 로 쌓인 대기 intent 는 그 뒤에 한 번에 — {@link #drain()} 참고) ② MOVING
     * actor 전진 ③ 도착 처리(경로당 1회) ④ Snapshot({@code publishSnapshot} 이고 MOVING 이 있었거나
     * 바로 전 틱까지 있었으면, N15) ⑤ serverTick 저장.
     *
     * <p>패키지 전용 — {@code publishSnapshot=false} 는 catch-up(밀린) 틱 전용이다(codex P2, 2246
     * 보완4, {@link MovementTicker#isCatchUp}). 이동 전진은 catch-up 틱에서도 그대로 한다 — 벽시계
     * 속도를 유지해야 앱의 시간 기준 투영이 느려지지 않는다. <b>Snapshot 발행만</b> 건너뛰고, 「멈춘 뒤
     * +1틱」 발행 의무는 {@code lastTickHadMoving} 에 그대로 담아 다음 발행 틱으로 넘긴다.
     */
    void tick(long tickNumber, boolean publishSnapshot) {
        this.serverTick = tickNumber;
        drain();
        boolean movingNow = advanceMovementAndReportMoving();
        if (!publishSnapshot) {
            lastTickHadMoving = lastTickHadMoving || movingNow; // 발행 의무를 다음 발행 틱으로 넘긴다.
        } else {
            if (movingNow || lastTickHadMoving) {
                emitSnapshot(snapshotOf());
            }
            lastTickHadMoving = movingNow;
        }
        pruneExpiredDeparted();
    }

    /**
     * Ticker 가 빈 방을 지우려고 쓴다 — actors·명령 큐(accept 로 들어온 대기 Intent 도 이 큐 안에 있다,
     * 2246 보완7)·퇴장 기억(N23)·사용자 토큰 버킷(2246 보완10)이 전부 비어야 한다(codex P1/P2, 2246 보완2).
     *
     * <p>큐까지 보는 이유: actors 만 보면 "지우기로 판단한 순간"과 "실제로 지우는 순간" 사이에 다른
     * 스레드의 {@link MovementRooms#join}·{@link MovementRooms#accept} 호출이 들어와도 그대로
     * 지워버려 명령이 유실된다. {@link MovementRooms#remove} 가 같은 섬 키로 {@code
     * ConcurrentHashMap.compute} 안에서 이 메서드를 재확인하므로, 저 호출들이 그보다 먼저 끝났으면 여기서
     * 보이고(지우지 않는다), 나중에 시작했으면 빈 맵에 새 방을 만들어 받는다 — 반쪽짜리로 끼어드는 경우가
     * 없다. departed 까지 보는 이유: 마지막 퇴장자의 위치 기억이 방과 함께 사라지면 10분 안 재입장
     * 복원(N23)이 깨진다.
     *
     * <p>버킷은 사용자 제한의 기억이라 방과 같이 사라지면 제한이 리셋된다(codex P2, 2246 보완10) — join
     * 없이 accept 만 반복하면 큐는 매 틱 비어도 소진된 버킷이 남는데, 그걸 안 보고 지우면 다음 accept 가
     * 새 방의 가득 찬 burst(20)를 다시 받는 우회가 된다. 방 객체 하나·버킷 하나뿐이라 버킷이 마지막 사용
     * 뒤 10분(prune, {@link #pruneExpiredDeparted}) 지날 때까지 방이 더 사는 비용은 무시한다.
     *
     * <p><b>틱 스레드 전용</b> — {@code actors}·{@code departed} 를 동기화 없이 읽는다(2246 보완11).
     * {@code userBuckets} 만 예외로 {@link ConcurrentHashMap} 이라 다른 스레드의 {@link #accept} 와
     * 동시에 읽어도 안전하지만, 그 대신 방 수명이 actor·퇴장 기억 수명뿐 아니라 버킷 수명과도 묶인다(바로
     * 위 문단, 2246 보완10).
     */
    boolean isRemovable() {
        return actors.isEmpty() && queue.isEmpty() && departed.isEmpty() && userBuckets.isEmpty();
    }

    /** 패키지 전용 — 테스트용. 지금 기억 중인 퇴장 인원 수(N23). */
    int departedCount() {
        return departed.size();
    }

    /** 패키지 전용 — 테스트용. 토큰 버킷 초과로 조용히 버려진 intent 수(codex P2, N8). */
    long rateLimitedDropCount() {
        return rateLimitedDropCount.get();
    }

    /** 패키지 전용 — 테스트용. 지금 살아 있는 사용자 토큰 버킷 수(codex P2, 2246 보완5). */
    int bucketCount() {
        return userBuckets.size();
    }

    // ── 콜백 전송(예외 삼킴) ────────────────────────────────────────────

    /**
     * {@code listener.onEvent} 콜백 하나를 내보낸다 — 전송 실패(런타임 예외)를 여기서 삼킨다(codex P1,
     * 2246 보완8). actors·departed 갱신 같은 상태 변경은 이 호출 전에 이미 끝나 있다 — 콜백이 던져도
     * {@link #drain()} 의 배치 루프는 끊기지 않고 다음 명령(다른 사용자의 Join·Leave·Intent)으로 이어진다.
     * 전송 실패는 전송 층(2247 Outbox)의 문제이지 방 상태 기계를 멈출 이유가 아니다.
     */
    private void emit(MovementEvent event, Target target) {
        try {
            listener.onEvent(islandId, event, target);
        } catch (RuntimeException e) {
            LOG.warn("섬 {} 이벤트 {} 전송 콜백 실패 — 삼키고 계속한다(codex P1, 2246 보완8)", islandId,
                    event.getClass().getSimpleName(), e);
        }
    }

    /** {@link #emit} 과 같은 이유로 {@code listener.onSnapshot} 콜백의 예외도 삼킨다(codex P1, 2246 보완8). */
    private void emitSnapshot(MovementEvent.Snapshot snapshot) {
        try {
            listener.onSnapshot(islandId, snapshot);
        } catch (RuntimeException e) {
            LOG.warn("섬 {} Snapshot 전송 콜백 실패 — 삼키고 계속한다(codex P1, 2246 보완8)", islandId, e);
        }
    }

    // ── 큐 드레인 ────────────────────────────────────────────────────────

    /**
     * join·leave·applyLayout·requestFullState·accept(큐에 쌓인 {@link Intent}) 는 전부 같은 큐에
     * 쌓인 순서(FIFO) 그대로 한 루프에서 처리한다(codex P2, 2246 보완5·보완7 — {@code instanceof}
     * 체인, Java 17 이라 패턴 switch 는 쓰지 않는다). 예전엔 타입별로 나눠 돌았는데, 같은 STOMP
     * 세션에서 {@code leave(s1)} 뒤 {@code join(U, s1)} 이 한 틱 안에 들어오면(앱 채널 effect 의
     * cleanup→재구독이 수 ms 안에 일어나 실제로 난다) Join 패스가 먼저 전부 돌아 멱등으로 무시되고,
     * 뒤이은 Leave 패스가 방금 재입장한 actor 를 지워버렸다. FIFO 로 고치면 큐에 들어온 순서 그대로
     * Leave → Join 이 처리돼 재입장이 살아남는다.
     *
     * <p>{@link Intent} 는 즉시 적용하지 않는다 — 이번 배치 안에서 세션당 최신 1개로 로컬 {@code
     * latest} 에 합치고(더 큰 commandSeq 만 남긴다), {@link Leave} 가 그 세션의 actor 를 실제로
     * 지운 순간엔({@link #processLeave} 가 {@code true} 를 돌려줄 때만 — 이미 교체된 세션의 뒷북
     * leave 는 포함되지 않는다) 그 세션의 {@code latest} 항목도 함께 지운다 — 퇴장 전 intent 는
     * 입장과 함께 죽는다(2246 보완6). 루프가 끝난 뒤에야 {@code latest} 를 순서대로
     * {@link #processAccept} 하므로, 퇴장 뒤(같은 틱 재입장 뒤) 들어온 Intent 는 루프 중 지워지지
     * 않고 새 actor 에 적용된다(2246 보완7). 같은 틱에 requestFullState 와 intent 가 함께 오면
     * FullState 가 PathAccepted 보다 먼저 나간다 — PathAccepted 가 곧바로 경로를 갱신하므로 계약상
     * 문제없다.
     *
     * <p>명령 하나(또는 루프 뒤 {@code latest} 항목 하나)의 처리는 {@link #guarded} 로 감싼다(2246
     * 보완11) — {@link #processJoin}(스폰 없음 NPE)·{@link #processAccept}(pathfinder 예외) 등에서
     * {@link RuntimeException} 이 나도 이 for 문이 멈추지 않는다. 감싸지 않으면 예외가 {@link #drain()}
     * 밖으로 새 {@link #tick(long, boolean)} 전체가 던지고, 배치의 나머지(다른 사용자의
     * Join/Leave/RequestFullState·{@code latest} 의 intent 전부)가 사라지며 이번 틱의 이동 전진도
     * 건너뛴다 — Leave 유실은 그대로 유령 사용자가 된다. {@link #emit}·{@link #emitSnapshot} 과 같은
     * 수준의 격리다.
     */
    private void drain() {
        List<Command> batch = new ArrayList<>();
        for (Command c = queue.poll(); c != null; c = queue.poll()) {
            batch.add(c);
        }
        Map<String, MoveIntent> latest = new LinkedHashMap<>();
        for (Command c : batch) {
            if (c instanceof Join j) {
                guarded("Join session=" + j.sessionKey(), () -> processJoin(j));
            } else if (c instanceof Leave l) {
                boolean[] removed = {false};
                guarded("Leave session=" + l.sessionKey(), () -> removed[0] = processLeave(l));
                if (removed[0]) {
                    latest.remove(l.sessionKey());
                }
            } else if (c instanceof ApplyLayout a) {
                guarded("ApplyLayout revision=" + a.layoutRevision(), () -> processApplyLayout(a));
            } else if (c instanceof RequestFullState r) {
                guarded("RequestFullState session=" + r.sessionKey(), () -> processRequestFullState(r));
            } else if (c instanceof Intent i) {
                latest.merge(i.sessionKey(), i.intent(), RoomRuntime::newerIntent);
            }
        }
        for (Map.Entry<String, MoveIntent> entry : latest.entrySet()) {
            guarded("Accept session=" + entry.getKey(), () -> processAccept(entry.getKey(), entry.getValue()));
        }
    }

    /**
     * {@link #drain()} 의 명령(또는 latest 항목) 하나를 실행하며 {@link RuntimeException} 을 격리한다
     * (2246 보완11, {@link #emit} 과 같은 수준) — 이 명령만 건너뛰고 배치의 나머지는 계속한다. {@code
     * what} 에 섬 대신 명령 종류·세션을 담는다 — 섬은 로그 호출부가 {@link #islandId} 로 이미 채운다.
     */
    private void guarded(String what, Runnable r) {
        try {
            r.run();
        } catch (RuntimeException e) {
            LOG.warn("섬 {} 명령 처리 실패({}) — 이 명령만 건너뛰고 배치의 나머지는 계속한다(2246 보완11)", islandId, what, e);
        }
    }

    /** 역순으로 도착해도 더 큰 commandSeq 만 남도록 고른다({@link #drain()} 의 세션당 최신 1개 병합). */
    private static MoveIntent newerIntent(MoveIntent oldIntent, MoveIntent newIntent) {
        return newIntent.commandSeq() > oldIntent.commandSeq() ? newIntent : oldIntent;
    }

    private void processJoin(Join cmd) {
        Actor actor = actors.get(cmd.userId());
        if (actor == null) {
            MovementEvent.Point spawn = spawnOrDepartedPosition(cmd.userId());
            actor = new Actor(cmd.userId(), cmd.sessionKey(), spawn.x(), spawn.y());
            actors.put(cmd.userId(), actor);
        } else {
            if (actor.sessionKey.equals(cmd.sessionKey())) {
                // 같은 세션의 중복 join 은 멱등이다(codex P2, 2246 보완4) — 세션 교체가 아니므로
                // lastCommandSeq·토큰 버킷·sessionToUser 를 그대로 두고 FullState 도 다시 보내지 않는다.
                // 그러지 않으면 이미 채택한 commandSeq 를 다시 수락하거나 순간 제한이 리셋된다. 중복
                // SUBSCRIBE 는 2247 의 requestFullState 가 별도로 받으므로 여기서는 챙기지 않는다.
                return;
            }
            // 두 번째 세션이 교체 — 위치·경로는 유지, 명령 번호만 새 세션 기준으로 리셋(N6, N20). 토큰
            // 버킷은 세션이 아니라 사용자 기준이라(2246 보완5) 여기서 지울 게 없다 — 재접속을 반복해도
            // 버킷은 그대로 이어져, 순간 20 을 다시 받는 우회가 되지 않는다.
            actor.sessionKey = cmd.sessionKey();
            actor.lastCommandSeq = 0;
        }
        sessionToUser.put(cmd.sessionKey(), cmd.userId());
        emit(fullStateOf(), Target.ALL);
    }

    /**
     * @return 이 세션의 actor 를 실제로 지웠으면 true. {@link #drain()} 이 이 신호로만 그 세션의
     *     {@code latest} 대기 Intent 를 함께 지운다 — 퇴장 전 intent 는 입장과 함께 죽어야 하기
     *     때문이다(같은 틱에 재입장(leave→join, 같은 세션 키)한 새 actor 에 옛 명령이 그대로 적용돼
     *     의도치 않게 움직이는 것을 막는다, 2246 보완6). 이미 다른 세션으로 교체된 뒤의 뒷북 leave(아래
     *     두 번째 분기)는 세션 키가 달라 원래 다른 세션의 대기 Intent 를 건드리지 않으므로 false.
     */
    private boolean processLeave(Leave cmd) {
        UUID userId = sessionToUser.remove(cmd.sessionKey());
        if (userId == null) {
            return false;
        }
        Actor actor = actors.get(userId);
        if (actor == null || !actor.sessionKey.equals(cmd.sessionKey())) {
            return false; // 이미 다른 세션으로 교체된 뒤의 뒷북 — 그 세션의 actor 를 건드리지 않는다.
        }
        actors.remove(userId);
        // 토큰 버킷(사용자 기준, 2246 보완5)은 여기서 지우지 않는다 — departed 에 남아 있는 10분
        // 동안 유지돼야 그 안에 재접속해도 순간 20 을 다시 받지 못한다. 정리는 pruneExpiredDeparted().
        departed.put(userId, new Departed(new MovementEvent.Point(actor.x, actor.y), serverTick));
        emit(fullStateOf(), Target.ALL);
        return true;
    }

    private void processAccept(String sessionKey, MoveIntent intent) {
        Actor actor = actorFor(sessionKey);
        if (actor == null) {
            // 퇴장 뒤 지연 도착한 Intent, 또는 join 없이 들어온 가짜 accept(codex P2, 2246 보완5) —
            // 세션 자체가 유효하지 않다. 정리할 대기 맵이 더 없다(2246 보완7 — latest 는 drain() 의
            // 로컬 변수라 이 틱이 끝나면 사라진다). 토큰 버킷(사용자 기준)도 여기서 지우지 않는다 —
            // actor 도 departed 도 없는 사용자의 버킷은 pruneExpiredDeparted() 가 지운다.
            return;
        }
        if (intent.commandSeq() <= actor.lastCommandSeq) {
            reject(actor, sessionKey, intent.commandSeq(), RejectReason.STALE_COMMAND);
            return;
        }
        // commandSeq 는 단조 증가로 다룬다(codex PR 리뷰, 2246 보완11) — 이 아래부터는 수락이든
        // STALE_COMMAND 가 아닌 거절(NAV_REVISION_MISMATCH·OUT_OF_RANGE·NO_REACHABLE_GOAL)이든 이
        // commandSeq 가 "처리 종료" 상태라, 먼저 반영해 둬야 뒤늦게 도착한 더 작은 commandSeq 가
        // STALE_COMMAND 로 밀린다(예전엔 거절 분기들이 반영하지 않아 거절된 commandSeq 보다 작은 뒷북이
        // 다시 수락돼 위치를 바꿀 수 있었다). 거절 분기마다 따로 대입하지 않도록 여기 한 곳에서만 한다.
        actor.lastCommandSeq = intent.commandSeq();
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
        // A* 는 그대로 이 틱 스레드에서 동기 호출 — Micrometer 로 호출 수·소요만 센다(N10, P1 반박 대응).
        Optional<PathResult> found = pathfindTimer.record(() -> pathfinder.find(nav, from, to));
        if (found.isEmpty()) {
            reject(actor, sessionKey, intent.commandSeq(), RejectReason.NO_REACHABLE_GOAL);
            return;
        }
        List<MovementEvent.Point> waypoints = toWaypoints(found.get());
        // start 는 밖으로 나가는 좌표라 emitted() 로 계약 정밀도(0.01)에 맞춘다(codex P2, 2246 보완9) — actor.x/y
        // 자체는 원시 double 그대로 둔다.
        MovementEvent.Point start = emitted(actor.x, actor.y);
        // goal 은 탭 좌표가 아니라 서버가 확정한 도착점(보정된 마지막 waypoint, 같은 셀이면 현재 위치) — HLD 「확정 도착」.
        // start·waypoints 가 이미 emitted() 를 거쳤으니 goal 도 자동으로 같은 정밀도다.
        MovementEvent.Point goal = waypoints.isEmpty() ? start : waypoints.get(waypoints.size() - 1);
        actor.pathId++;
        actor.waypoints = waypoints;
        actor.segmentIndex = 0;
        actor.state = MotionState.MOVING;
        MovementEvent.PathAccepted accepted = new MovementEvent.PathAccepted(actor.userId, actor.lastCommandSeq,
                actor.pathId, rules.navRevision(), serverTick, start, goal, rules.speed(), waypoints);
        emit(accepted, Target.ALL);
        // waypoints 가 비어 있으면(같은 셀) advanceMovementAndReportMoving() 이 이번 틱에 바로 Arrived 를 낸다.
    }

    private void processApplyLayout(ApplyLayout cmd) {
        this.layoutRevision = cmd.layoutRevision();
        LOG.info("섬 {} 레이아웃 버전 {} 수신 — 1단계는 통행 칸을 바꾸지 않는다(N11)", islandId, cmd.layoutRevision());
    }

    private void processRequestFullState(RequestFullState cmd) {
        if (actorFor(cmd.sessionKey()) == null) {
            // 이 세션이 같은 틱에 먼저 드레인된 leave 로 이미 떠났거나(큐 순서(FIFO)상 Leave 가 앞,
            // 2246 보완5) 세션이 교체돼 다른 세션이 이 actor 를 들고 있다(codex P2, 2246 보완3) —
            // 퇴장한 세션에 FullState 를 보내지 않는다.
            return;
        }
        emit(fullStateOf(), Target.only(cmd.sessionKey()));
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
        // 거절 응답도 밖으로 나가는 좌표라 emitted() 를 거친다(codex P2, 2246 보완9) — 같은 틱의 Snapshot·
        // FullState 와 정밀도가 어긋나면 안 된다.
        MovementEvent.Point position = emitted(actor.x, actor.y);
        MovementEvent.MoveRejected event = new MovementEvent.MoveRejected(actor.userId, commandSeq, reason,
                rules.navRevision(), position);
        emit(event, Target.only(sessionKey));
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
                // Arrived.position 도 밖으로 나가는 좌표라 emitted() 를 거친다(codex P2, 2246 보완9).
                MovementEvent.Point position = emitted(actor.x, actor.y);
                MovementEvent.Arrived arrived =
                        new MovementEvent.Arrived(actor.userId, actor.pathId, serverTick, position);
                emit(arrived, Target.ALL);
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
            // 셀 중심은 이미 0.5 단위라 emitted() 반올림은 무해하다 — 그래도 같은 헬퍼를 거쳐야 PathAccepted·
            // FullState 로 나가는 waypoints 가 정밀도 규칙의 예외가 되지 않는다(codex P2, 2246 보완9).
            points.add(emitted(center.x(), center.y()));
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
     *
     * <p>같은 틱에 토큰 버킷도 정리한다(codex P2, 2246 보완5) — actor 도 departed 도 없는 사용자는
     * 더 이상 이 방과 관계가 없으니 버킷을 들고 있을 이유가 없다. 다만 actor·departed 부재만으로 바로
     * 지우면 join 없이 accept 만 반복하는 사용자의 버킷이 매 틱 지워지고 다음 틱에 새 버킷이 burst(20)
     * 를 다시 줘 초당 제한을 우회한다(codex P1, 2246 보완8) — 그래서 마지막 사용({@link
     * Bucket#lastTouchedNanos()}) 뒤 {@link #DEPARTED_MEMORY_NANOS}(10분) 가 지난 버킷만 지운다.
     * {@code userBuckets} 는 {@link ConcurrentHashMap} 이라 이 순회(스레드: 틱)가 {@link #accept}
     * (스레드: STOMP)의 동시 삽입과 겹쳐도 안전하다.
     */
    private void pruneExpiredDeparted() {
        long window = rules.ticksFor(DEPARTED_MEMORY_MS);
        departed.values().removeIf(d -> serverTick - d.tick() > window);
        long now = nowNanos.getAsLong();
        userBuckets.entrySet().removeIf(entry -> !actors.containsKey(entry.getKey())
                && !departed.containsKey(entry.getKey())
                && now - entry.getValue().lastTouchedNanos() > DEPARTED_MEMORY_NANOS);
    }

    // ── 스냅샷 ────────────────────────────────────────────────────────────

    /**
     * 패키지 전용 — 테스트·Ticker 용. 좌표는 Snapshot 과 같은 정밀도(0.01)로 반올림한다(codex P2, 2246 보완9) —
     * 전엔 actor.x/y 원시값을 그대로 내보내 재동기화(requestFullState) 직후 같은 흐름의 Snapshot 좌표와 어긋나
     * 위치가 튀었다(policy.md §3 좌표 정밀도).
     */
    MovementEvent.FullState fullStateOf() {
        List<MovementEvent.ActorState> states = new ArrayList<>(actors.size());
        for (Actor actor : actors.values()) {
            states.add(new MovementEvent.ActorState(actor.userId, round2(actor.x), round2(actor.y), actor.state,
                    actor.pathId, actor.lastCommandSeq, remainingWaypoints(actor)));
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

    /**
     * actor 의 raw 좌표를 송신 경계에서 계약 정밀도(0.01 world unit, policy.md §3)로 반올림해 {@link
     * MovementEvent.Point} 로 감싼다(codex P2, 2246 보완9) — FullState·PathAccepted.start·Arrived.position·
     * MoveRejected.position·waypoints 가 이 메서드 하나를 거쳐야 같은 흐름의 서로 다른 메시지 좌표가 어긋나지
     * 않는다. {@code actor.x/y} 자체와 waypoint 전진 수학({@link #step})은 원시 double 그대로 둔다 — 반올림은
     * 여기, 내보내는 자리에서만 한다.
     */
    private static MovementEvent.Point emitted(double x, double y) {
        return new MovementEvent.Point(round2(x), round2(y));
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

    private record ApplyLayout(long layoutRevision) implements Command {
    }

    private record RequestFullState(String sessionKey) implements Command {
    }

    /**
     * {@link #accept} 가 토큰 버킷을 통과시킨 intent 한 건 — 다른 명령과 같은 큐에 들어가 FIFO 로
     * 드레인된다. 세션당 최신 1개로 합치는 일은 큐에 넣을 때가 아니라 {@link #drain()} 이 배치 끝에
     * 한 번에 한다(별도 pendingIntent 슬롯 없음, 2246 보완7).
     */
    private record Intent(String sessionKey, MoveIntent intent) implements Command {
    }

    /** 퇴장 위치 기억(N23) 한 건. */
    private record Departed(MovementEvent.Point position, long tick) {
    }

    /**
     * 사용자별 토큰 버킷(policy §3, N8) — {@link #accept} 호출 스레드에서 직접 소모한다(codex P2,
     * 2246 보완5). 리필 기준은 틱 번호가 아니라 생성 시점에 받는 나노초 시계(기본은 벽시계) — accept
     * 는 틱 스레드 밖에서 불린다. {@code lastTouchedNanos} 는 리필 계산용 {@code lastRefillNanos} 와
     * 별개로 "마지막으로 이 버킷을 썼는가"만 기록한다(codex P1, 2246 보완8) — {@link
     * #pruneExpiredDeparted} 가 이 값으로 join 없는 사용자의 버킷을 너무 일찍 지우지 않는다.
     */
    private static final class Bucket {

        private double tokens;
        private long lastRefillNanos;
        private long lastTouchedNanos;

        Bucket(double initialTokens, long nowNanos) {
            this.tokens = initialTokens;
            this.lastRefillNanos = nowNanos;
            this.lastTouchedNanos = nowNanos;
        }

        synchronized boolean tryConsume(long nowNanos, MovementRules rules) {
            lastTouchedNanos = nowNanos;
            long elapsedNanos = nowNanos - lastRefillNanos;
            if (elapsedNanos > 0) {
                double refill = elapsedNanos * rules.maxIntentsPerSec() / 1_000_000_000.0;
                tokens = Math.min(rules.intentBurst(), tokens + refill);
                lastRefillNanos = nowNanos;
            }
            if (tokens < 1.0) {
                return false;
            }
            tokens -= 1.0;
            return true;
        }

        synchronized long lastTouchedNanos() {
            return lastTouchedNanos;
        }
    }
}

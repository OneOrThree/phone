package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.movement.MoveIntent;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.MovementRooms;
import com.oneorthree.realtime.movement.stomp.MovementOwnership.Lease;
import com.oneorthree.realtime.movement.stomp.MovementOwnership.Owner;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Command;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Frame;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Type;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 이동 명령의 길잡이(GROMO-2339) — 세션의 JOIN·LEAVE·INTENT·FULL_STATE 를 그 섬 소유자에게 보낸다. 내가 소유자면 로컬
 * {@link MovementRooms}, 아니면 {@code chat:movement:cmd:v1}. 소유자가 낸 프레임({@code chat:movement:frames:v1})은
 * 전 인스턴스가 받아 자기 세션에만 넣는다 — 소유자 자신도 그 메아리로만 넣어 전달 경로가 하나다.
 *
 * <p><b>기본은 ON 이다. 옵트아웃({@code realtime.movement.multi-instance.enabled=false})하면 모든 메서드가
 * {@link MovementRooms} 를 바로 부른다</b> — 세션 키 = STOMP 세션 id, Redis 0회, 스레드 0개. 현행 단일 인스턴스 동작 그대로다.
 *
 * <h2>스레드 모델(ON)</h2>
 * <ul>
 *   <li>{@code movement-cluster}(1스레드) — 라우팅·소유권(획득·갱신·반납·상실)·명령 적용·1초 감시를 전부 여기서 한다. 한
 *       스레드라 «적용 중에 리스 반납» 같은 경합이 없고, 세션 하나의 명령 순서가 그대로 보존된다. 인바운드 스레드(세션 잠금
 *       안)는 넣기만 한다 — Redis 를 기다리지 않는다.</li>
 *   <li>{@code movement-relay-in}(1스레드, 전용 {@code RedisMessageListenerContainer}) — 받은 프레임을 바로 outbox 에
 *       넣고(비차단), 명령은 {@code movement-cluster} 로 넘긴다. 기존 채팅 컨테이너와 나눈 이유는 순서다.</li>
 *   <li>{@code movement-relay-out}(1스레드, {@link MovementRelay}) — 파이프라인 PUBLISH.</li>
 * </ul>
 *
 * <h2>실패 모드</h2>
 * 리스 상실(남이 가져감·갱신 실패 2초) → 그 섬 방을 버리고({@link MovementRooms#evict}) 발행을 멈춘다(fail-closed). 소유자
 * 교체를 보면(감시·더 큰 epoch 프레임) 그 섬의 내 세션 전부 게이트를 닫고(resync) 새 소유자에게 다시 입장시킨다 —
 * 새 소유자의 세션 한정 FullState 가 게이트를 다시 연다(wire 변경 없음 — 앱은 serverTick 역행을 이미 수렴한다).
 * 옛 epoch 프레임은 버린다({@code movement.relay.stale}).
 */
@Slf4j
@Component
public class MovementCluster implements MessageListener, SmartLifecycle {

    static final long POLL_MS = 1000;
    /** 방이 비어도 갓 얻은 리스는 이만큼은 들고 있는다 — 얻자마자 첫 명령 전에 반납하는 경합을 막는다. */
    private static final long RELEASE_GRACE_NANOS = TimeUnit.SECONDS.toNanos(5);
    /** 생존 신호(PING)가 이만큼 끊긴 인스턴스의 세션 actor 는 소유자가 내보낸다(기본 5초 — 테스트만 줄인다). */
    private static final long INSTANCE_STALE_MS = 5000;
    /** 세션 한정 FullState 를 이만큼 못 받으면 다시 요청한다. */
    private static final long FULL_STATE_RETRY_NANOS = TimeUnit.SECONDS.toNanos(2);
    private static final Duration HANDOFF_TTL = Duration.ofSeconds(30);
    private static final TypeReference<Map<UUID, MovementEvent.Point>> POSITIONS = new TypeReference<>() {
    };

    private final boolean enabled;
    private final long instanceStaleNanos;
    private final MovementRooms rooms;
    private final MovementPublisher publisher;
    private final MovementOwnership ownership;
    private final MovementRelay relay;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final ObjectProvider<MovementSubscriptionListener> listeners;
    private final String me;

    private ScheduledExecutorService executor;
    private ExecutorService relayIn;
    private volatile boolean running;

    // ── movement-cluster 스레드 전용 ──
    /** 내가 아는 섬별 소유자(나 포함). 그 섬에 내 세션이 있거나 내가 소유자인 동안만 둔다. */
    private final Map<UUID, Owner> owners = new HashMap<>();
    /** 소유자를 못 정해 입장을 못 보낸 섬 — 감시가 소유자를 알아내면 그때 다시 입장시킨다. */
    private final Set<UUID> pendingRejoin = new HashSet<>();
    /** 세션({@code 섬|세션})별 마지막 FULL_STATE 요청(또는 게이트 닫힘을 처음 본) 시각 — {@link #retryFullStates}. */
    private final Map<String, Long> fullStateRequestedAt = new HashMap<>();
    /** 소유자 쪽: 내 방에 들어온 다른 인스턴스의 세션 키(섬 → 세션 키). 그 인스턴스가 끊기면 내보낸다. */
    private final Map<UUID, Set<String>> remoteSessions = new HashMap<>();

    // ── 여러 스레드 ──
    /** 섬별로 본 가장 큰 epoch — 그보다 작은 프레임은 옛 소유자의 것이다(relay-in 이 읽고 쓴다). */
    private final Map<UUID, Long> seenEpochs = new ConcurrentHashMap<>();
    /**
     * 인스턴스별 «내게 온» 마지막 PING 시각(nanoTime, relay-in 이 쓴다; 수신자 null 포함, 원격 JOIN 때 한 번 심는다).
     * 내게 PING 을 안 보내는 인스턴스(내 섬에 세션이 없다)의 actor 는 유령이라 {@code instance-stale-ms} 뒤 내보낸다.
     */
    private final Map<String, Long> lastPinged = new ConcurrentHashMap<>();
    /** 다른 인스턴스의 새 세션이 actor 를 가져간 내 세션({@code 섬|세션}) — 그 세션 intent 는 버린다. */
    private final Set<String> replaced = ConcurrentHashMap.newKeySet();

    private final Counter acquiredByRoute;
    private final Counter acquiredByTakeover;
    private final Counter lostStolen;
    private final Counter lostExpired;
    private final Counter staleNotOwner;
    private final Counter staleEpoch;
    private final Counter routingRedis;
    private final Counter relayStale;
    private final Counter fullStateRetried;
    private final Timer pollTimer;
    /** 내 앞으로 오는 PING 채널 — {@code RedisConfig} 가 구독한다. */
    private final String ownCmdChannel;
    private final Map<Type, Counter> forwarded = new HashMap<>();

    /**
     * {@code instance-stale-ms} 는 운영 env 로 열지 않는 테스트용 손잡이다(기본 5000) — 생존 신호 단절 테스트가 5초 타이머를
     * 기다리지 않게 한다. PING 이 1초라 2초 아래로 내리면 정상 부하에서도 actor 를 잘못 내보낸다.
     */
    @Autowired
    public MovementCluster(@Value("${realtime.movement.multi-instance.enabled:true}") boolean enabled,
            MovementRooms rooms, MovementPublisher publisher, MovementOwnership ownership, MovementRelay relay,
            StringRedisTemplate redis, ObjectMapper objectMapper,
            ObjectProvider<MovementSubscriptionListener> listeners, MeterRegistry meterRegistry,
            @Value("${realtime.movement.multi-instance.instance-stale-ms:" + INSTANCE_STALE_MS + "}")
            long instanceStaleMs) {
        this.enabled = enabled;
        this.instanceStaleNanos = TimeUnit.MILLISECONDS.toNanos(instanceStaleMs);
        this.rooms = rooms;
        this.publisher = publisher;
        this.ownership = ownership;
        this.relay = relay;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.listeners = listeners;
        this.me = ownership == null ? "" : ownership.instanceId();
        MeterRegistry meters = meterRegistry;
        this.acquiredByRoute = acquireCounter(meters, "route");
        this.acquiredByTakeover = acquireCounter(meters, "takeover");
        this.lostStolen = lostCounter(meters, "stolen");
        this.lostExpired = lostCounter(meters, "expired");
        this.staleNotOwner = Counter.builder("movement.owner.forward.stale").tag("reason", "not_owner")
                .description("나에게 온 명령인데 내가 그 섬 소유자가 아니라 버린 수").register(meters);
        this.staleEpoch = Counter.builder("movement.owner.forward.stale").tag("reason", "epoch")
                .description("나에게 온 명령인데 보낸 쪽이 본 epoch 가 지금 리스와 달라 버린 수").register(meters);
        this.routingRedis = Counter.builder("movement.routing.failed").tag("reason", "redis")
                .description("소유자를 Redis 로 알아내지 못해 보내지 못한 이동 명령 수").register(meters);
        this.relayStale = Counter.builder("movement.relay.stale")
                .description("그 섬에서 본 epoch 보다 작은(옛 소유자) 프레임이라 버린 수").register(meters);
        this.fullStateRetried = Counter.builder("movement.fullstate.retry")
                .description("세션 한정 FullState 를 2초 넘게 못 받아 다시 요청한 수(codex r1 P1)").register(meters);
        this.ownCmdChannel = RedisKeys.movementCmdChannel(me);
        this.pollTimer = Timer.builder("movement.cluster.poll")
                .description("movement-cluster 1초 감시 한 틱(poll) 처리 시간 — submit 작업은 포함하지 않는다")
                .publishPercentileHistogram().register(meters);
        for (Type type : Type.values()) {
            forwarded.put(type, Counter.builder("movement.owner.forward").tag("type", type.name())
                    .description("다른 인스턴스(소유자)로 보낸 이동 명령 수").register(meters));
        }
    }

    /** 패키지 전용 — 테스트가 기본 생존 신호 한도로 만든다. */
    MovementCluster(boolean enabled, MovementRooms rooms, MovementPublisher publisher, MovementOwnership ownership,
            MovementRelay relay, StringRedisTemplate redis, ObjectMapper objectMapper,
            ObjectProvider<MovementSubscriptionListener> listeners, MeterRegistry meterRegistry) {
        this(enabled, rooms, publisher, ownership, relay, redis, objectMapper, listeners, meterRegistry,
                INSTANCE_STALE_MS);
    }

    /** 플래그 OFF 그대로의 길잡이 — 테스트가 {@link MovementRooms} 만으로 처리기·컨트롤러를 만들 때. */
    static MovementCluster local(MovementRooms rooms) {
        return new MovementCluster(false, rooms, null, null, null, null, null, null,
                new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
    }

    /** 플래그 ON 인가 — OFF 면 호출자가 다중 인스턴스용 계산 자체를 건너뛴다. */
    public boolean isEnabled() {
        return enabled;
    }

    private static Counter acquireCounter(MeterRegistry meters, String trigger) {
        return Counter.builder("movement.owner.acquire").tag("trigger", trigger)
                .description("이동 방 소유자 리스를 새로 얻은 수 — route: 첫 명령, takeover: 감시가 빈 리스를 봄")
                .register(meters);
    }

    private static Counter lostCounter(MeterRegistry meters, String reason) {
        return Counter.builder("movement.owner.lost").tag("reason", reason)
                .description("이동 방 소유자 리스를 잃은 수 — stolen: 남의 값, expired: 로컬 한도(리스 수명의 9/10) 초과")
                .register(meters);
    }

    @PostConstruct
    void init() {
        if (!enabled) {
            return;
        }
        relayIn = Executors.newSingleThreadExecutor(daemon("movement-relay-in")); // 빈 수명 — 컨테이너가 이 참조를 쥔다
        startWorkers();
    }

    private void startWorkers() {
        running = true;
        executor = Executors.newSingleThreadScheduledExecutor(daemon("movement-cluster"));
        executor.scheduleWithFixedDelay(this::poll, POLL_MS, POLL_MS, TimeUnit.MILLISECONDS);
    }

    /** relay-in 실행기는 빈과 함께 끝낸다 — 수명주기 stop/start(테스트 컨텍스트 일시정지 등)를 넘어 컨테이너가 계속 쓴다. */
    @PreDestroy
    void destroy() {
        if (relayIn != null) {
            relayIn.shutdownNow();
        }
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        };
    }

    /** 전용 리스너 컨테이너({@code RedisConfig})의 실행기 — 1스레드라 받은 순서 그대로 처리한다. */
    public ExecutorService relayInExecutor() {
        return relayIn;
    }

    /**
     * 종료 인계(단계 B) — 소유한 섬마다 마지막 위치를 {@code movement:room:{id}:handoff}(30초)에 남기고 리스를 내놓는다.
     * 다른 인스턴스의 감시가 빈 리스를 보고 가져가 그 위치로 방을 다시 세운다.
     *
     * <p>{@code @PreDestroy} 가 아니라 수명주기 단계 {@link #getPhase()} 에서 한다 — Lettuce 연결 팩토리도 수명주기(단계 0)라
     * 빈 파괴 때는 이미 닫혀 있다. 웹 서버(세션 종료)가 먼저 멈춘 «뒤», Redis 가 닫히기 «전»에 돈다. 송신 줄도 여기서 비운다.
     */
    @Override
    public void stop() {
        if (!enabled || !running) {
            return;
        }
        running = false;
        executor.shutdown();
        try {
            executor.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        // 순서(#1180 claude r2): 인계 스냅샷 → 갱신 한 번 → 송신 줄 flush → RELEASE. RELEASE 를 먼저 하면 줄에 남은 프레임
        // (종료 직전 퇴장 FullState 등)이 PUBLISH 직전 재확인에서 «리스 없음»으로 버려진다. 갱신은 flush(≤2초) 동안 로컬
        // 신뢰 한도(2.7초)를 넘기지 않게 한 번 더 한다.
        Set<UUID> held = ownership.leases().keySet();
        for (UUID islandId : held) {
            try {
                Map<UUID, MovementEvent.Point> positions = relay.positions(islandId);
                if (!positions.isEmpty()) {
                    redis.opsForValue().set(RedisKeys.movementHandoff(islandId),
                            objectMapper.writeValueAsString(positions), HANDOFF_TTL);
                }
            } catch (RuntimeException e) {
                log.warn("이동 방 인계 실패 — 리스 만료(3초)로 넘어간다. reason={}", e.getClass().getSimpleName());
            }
            try { // 인계 set 이 실패해도 갱신은 한다 — flush 동안 로컬 신뢰 한도가 줄지 않게 별도 try
                ownership.renew(islandId);
            } catch (RuntimeException e) {
                log.warn("이동 리스 갱신 실패 — 리스 만료(3초)로 넘어간다. reason={}", e.getClass().getSimpleName());
            }
        }
        relay.stop();
        for (UUID islandId : held) {
            try {
                ownership.release(islandId);
            } catch (RuntimeException e) {
                log.warn("이동 리스 반납 실패 — 리스 만료(3초)로 넘어간다. reason={}", e.getClass().getSimpleName());
            }
        }
    }

    @Override
    public void start() {
        // 수명주기 재시작(Spring 7 테스트 컨텍스트 일시정지 → 재개 등) — stop() 이 멈춘 송신·감시를 다시 세운다. 반납한 리스는
        // 첫 명령·감시가 다시 얻는다(남은 방은 리스가 없어 lost{expired} 로 버리고 다시 세운다).
        if (!enabled || running) {
            return;
        }
        relay.start();
        startWorkers();
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    /** Lettuce 연결 팩토리(0)보다 먼저, 웹 서버 종료보다 나중에 멈춘다(수명주기는 단계가 높은 쪽부터 멈춘다). */
    @Override
    public int getPhase() {
        return 1;
    }

    // ── 세션 쪽 입구(인바운드 스레드, 세션 잠금 안 — 넣기만 한다) ─────────

    public void join(UUID islandId, UUID userId, String sessionId) {
        if (!enabled) {
            rooms.join(islandId, userId, sessionId);
            return;
        }
        replaced.remove(replacedKey(islandId, sessionId));
        submit(() -> route(islandId, Type.JOIN, userId, sessionId, null));
    }

    public void leave(UUID islandId, String sessionId) {
        if (!enabled) {
            rooms.leave(islandId, sessionId);
            return;
        }
        replaced.remove(replacedKey(islandId, sessionId));
        submit(() -> route(islandId, Type.LEAVE, null, sessionId, null));
    }

    public void accept(UUID islandId, UUID userId, String sessionId, MoveIntent intent) {
        if (!enabled) {
            rooms.accept(islandId, userId, sessionId, intent);
            return;
        }
        if (replaced.contains(replacedKey(islandId, sessionId))) {
            return; // 다른 인스턴스의 새 세션이 actor 를 가져갔다 — 공용 토큰 버킷을 먹지 않게 버린다(N6).
        }
        submit(() -> route(islandId, Type.INTENT, userId, sessionId, intent));
    }

    public void requestFullState(UUID islandId, String sessionId) {
        if (!enabled) {
            rooms.requestFullState(islandId, sessionId);
            return;
        }
        submit(() -> route(islandId, Type.FULL_STATE, null, sessionId, null));
    }

    /**
     * 강퇴 재검사를 다른 인스턴스에도 알린다 — 그 사람 세션이 어느 인스턴스에 붙어 있는지 모르니 전원에게 보낸다(각자 자기
     * 세션만 재판정한다). {@code cacheStale} 은 이 인스턴스에서 멤버십 캐시 삭제가 실패했다는 표시 — 받는 쪽도 그 표시를
     * 남긴다. OFF 면 아무것도 안 한다. 던지지 않는다.
     */
    void broadcastRecheck(UUID islandId, UUID userId, boolean cacheStale) {
        if (!enabled) {
            return;
        }
        relay.publishCommand(new Command(me, null, 0, islandId, Type.RECHECK, userId, null, null, cacheStale));
    }

    private void submit(Runnable task) {
        try {
            executor.execute(() -> {
                try {
                    task.run();
                } catch (RuntimeException e) {
                    log.warn("이동 명령 처리 실패 — reason={}", e.getClass().getSimpleName(), e);
                }
            });
        } catch (RuntimeException e) {
            log.debug("이동 길잡이 종료 중 — 명령을 버린다");
        }
    }

    // ── movement-cluster 스레드 ─────────────────────────────────────────

    private void route(UUID islandId, Type type, UUID userId, String sessionId, MoveIntent intent) {
        if (type == Type.FULL_STATE) {
            fullStateRequestedAt.put(replacedKey(islandId, sessionId), System.nanoTime());
        }
        Owner owner = resolveOwner(islandId);
        if (owner == null) {
            routingRedis.increment();
            if (type == Type.JOIN || type == Type.FULL_STATE) {
                pendingRejoin.add(islandId); // 감시가 소유자를 알아내면 다시 입장시킨다 — 게이트가 영영 닫혀 있지 않게.
            }
            return;
        }
        String sessionKey = MovementRelay.sessionKey(me, sessionId);
        if (owner.instanceId().equals(me)) {
            apply(islandId, type, userId, sessionKey, intent);
            return;
        }
        relay.publishCommand(new Command(me, owner.instanceId(), owner.epoch(), islandId, type, userId, sessionKey,
                intent, false));
        forwarded.get(type).increment();
    }

    /** 아는 소유자, 없으면 Redis 에 묻는다(비어 있으면 내가 갖는다). Redis 가 안 되면 null. */
    private Owner resolveOwner(UUID islandId) {
        Owner known = owners.get(islandId);
        if (known != null && known.instanceId().equals(me) && ownership.lease(islandId) == null) {
            lose(islandId, lostExpired); // 나라고 알고 있지만 리스가 로컬 한도를 넘겼다 — 방을 버리고 다시 알아낸다
            known = owners.get(islandId);
        }
        if (known != null) {
            return known;
        }
        try {
            Owner owner = ownership.acquire(islandId);
            if (owner.instanceId().equals(me)) {
                acquiredByRoute.increment();
                restoreHandoff(islandId);
            }
            observeOwner(islandId, owner);
            return owner;
        } catch (RuntimeException e) {
            log.warn("이동 방 소유자 조회 실패 — reason={}", e.getClass().getSimpleName());
            return null;
        }
    }

    private void restoreHandoff(UUID islandId) {
        String json = redis.opsForValue().getAndDelete(RedisKeys.movementHandoff(islandId));
        if (json != null) {
            rooms.restore(islandId, objectMapper.readValue(json, POSITIONS));
        }
    }

    /**
     * 그 섬 소유자가 {@code owner} 다. 내가 알던 소유자와 다르면(교체) 내 세션 전부 게이트를 닫고 새 소유자에게 다시
     * 입장시킨다. 더 작은 epoch 는 무시한다(늦게 도착한 옛 소식).
     */
    private void observeOwner(UUID islandId, Owner owner) {
        Owner previous = owners.get(islandId);
        if (previous != null && previous.epoch() > owner.epoch()) {
            return;
        }
        owners.put(islandId, owner);
        seenEpochs.merge(islandId, owner.epoch(), Math::max);
        boolean changed = previous != null && !previous.equals(owner);
        if (pendingRejoin.remove(islandId) || changed) {
            if (changed) {
                publisher.resyncAll(islandId);
            }
            rejoin(islandId);
        }
    }

    /** 이 인스턴스의 그 섬 세션을 지금 소유자에게 다시 입장시킨다(JOIN 다음 FULL_STATE — 방 큐 FIFO). */
    private void rejoin(UUID islandId) {
        for (MovementOutbox outbox : publisher.outboxes(islandId)) {
            if (eligible(islandId, outbox)) {
                route(islandId, Type.JOIN, outbox.userId(), outbox.sessionId(), null);
                route(islandId, Type.FULL_STATE, null, outbox.sessionId(), null);
            }
        }
    }

    private void apply(UUID islandId, Type type, UUID userId, String sessionKey, MoveIntent intent) {
        String origin = MovementRelay.instanceOf(sessionKey);
        switch (type) {
            case JOIN -> {
                rooms.join(islandId, userId, sessionKey);
                if (!origin.equals(me)) {
                    remoteSessions.computeIfAbsent(islandId, id -> new HashSet<>()).add(sessionKey);
                }
            }
            case LEAVE -> {
                rooms.leave(islandId, sessionKey);
                Set<String> remote = remoteSessions.get(islandId);
                if (remote != null) {
                    remote.remove(sessionKey);
                }
            }
            case INTENT -> rooms.accept(islandId, userId, sessionKey, intent);
            case FULL_STATE -> rooms.requestFullState(islandId, sessionKey);
            default -> {
            }
        }
    }

    /** 다른 인스턴스가 나에게 보낸 명령 — 지금 그 리스(같은 epoch)를 든 경우에만 적용한다. */
    private void applyForwarded(Command command) {
        Lease lease = ownership.lease(command.islandId());
        if (lease == null) {
            staleNotOwner.increment();
            return;
        }
        if (lease.epoch() != command.epoch()) {
            staleEpoch.increment();
            return;
        }
        if (command.type() == Type.JOIN) {
            // 첫 PING(최대 1초) 전에 sweep 이 방금 들어온 actor 를 내보내지 않게 한 번 심는다. 이후 갱신은 PING 만 한다.
            lastPinged.put(command.originInstanceId(), System.nanoTime());
        }
        apply(command.islandId(), command.type(), command.userId(), command.sessionKey(), command.intent());
    }

    /**
     * 단계마다 예외를 따로 삼킨다 — 한 단계가 던져도 나머지는 돈다(#1180 claude r2). 순서: 리스 갱신(발행 자격) → 복구 재송
     * (RECHECK·RESYNC·FULL_STATE 재요청 — 다른 단계 예외에 막히면 안 된다) → 반납·소유자 감시·생존 신호·끊긴 인스턴스 정리.
     */
    void poll() {
        pollTimer.record(this::pollOnce);
    }

    private void pollOnce() {
        step("renew", this::renewLeases);
        step("recheck-retry", () -> {
            for (Command recheck : relay.takeRechecks()) {
                relay.publishCommand(recheck); // 잃은 강퇴 재검사 — 또 잃으면 다시 표시된다
            }
        });
        step("resync", this::requestResyncs);
        step("fullstate-retry", this::retryFullStates);
        step("release-idle", this::releaseIdle);
        step("watch-owners", this::watchOwners);
        step("ping", () -> joinedSessionsByOwner().forEach((owner, sessions) -> relay.publishCommand(
                new Command(me, owner, 0, null, Type.PING, null, null, null, false, sessions))));
        step("sweep-dead", this::sweepDeadInstances);
    }

    private static void step(String name, Runnable body) {
        try {
            body.run();
        } catch (RuntimeException e) {
            log.warn("이동 소유자 감시 단계 실패 — step={} reason={}", name, e.getClass().getSimpleName());
        }
    }

    private void renewLeases() {
        for (UUID islandId : ownership.leases().keySet()) {
            if (ownership.lease(islandId) == null) {
                // 로컬 한도를 넘겼다(갱신 실패·이 스레드 지연) — 발행·적용은 이미 막혔고(lease()=null), 여기서 방을 버린다.
                lose(islandId, lostExpired);
                continue;
            }
            try {
                if (!ownership.renew(islandId)) {
                    lose(islandId, lostStolen);
                }
            } catch (RuntimeException e) {
                log.debug("이동 리스 갱신 실패 — 로컬 한도 안이면 다음 틱에 다시 한다");
            }
        }
    }

    /** 리스 상실 — 방을 버리고(fail-closed) 내 세션은 새 소유자(다시 알아낸다)에게 다시 입장시킨다. */
    private void lose(UUID islandId, Counter reason) {
        reason.increment();
        ownership.forget(islandId);
        rooms.evict(islandId);
        relay.forget(islandId);
        remoteSessions.remove(islandId);
        owners.remove(islandId);
        publisher.resyncAll(islandId);
        rejoin(islandId);
    }

    private void releaseIdle() {
        long now = System.nanoTime();
        for (Map.Entry<UUID, Lease> entry : ownership.leases().entrySet()) {
            UUID islandId = entry.getKey();
            if (!rooms.rooms().containsKey(islandId)
                    && now - entry.getValue().acquiredAtNanos() > RELEASE_GRACE_NANOS) {
                ownership.release(islandId);
                relay.forget(islandId);
                remoteSessions.remove(islandId);
                owners.remove(islandId);
            }
        }
    }

    /** 내 세션이 있는데 내가 소유자가 아닌 섬 — 소유자 값을 다시 읽어 교체를 알아챈다. 비어 있으면 내가 가져간다. */
    private void watchOwners() {
        Set<UUID> local = publisher.islands();
        List<UUID> watched = new ArrayList<>();
        for (UUID islandId : local) {
            if (ownership.lease(islandId) == null) {
                watched.add(islandId);
            }
        }
        owners.keySet().removeIf(id -> !local.contains(id) && ownership.lease(id) == null);
        pendingRejoin.removeIf(id -> !local.contains(id));
        seenEpochs.keySet().removeIf(id -> !local.contains(id) && ownership.lease(id) == null);
        if (watched.isEmpty()) {
            return;
        }
        List<String> values = redis.opsForValue().multiGet(watched.stream().map(RedisKeys::movementOwner).toList());
        for (int i = 0; i < watched.size(); i++) {
            UUID islandId = watched.get(i);
            String value = values == null ? null : values.get(i);
            if (value != null) {
                observeOwner(islandId, Owner.parse(value));
                continue;
            }
            Owner owner = ownership.acquire(islandId);
            if (owner.instanceId().equals(me)) {
                acquiredByTakeover.increment();
                restoreHandoff(islandId);
            }
            observeOwner(islandId, owner);
        }
    }

    /**
     * 내게 오는 PING 이 {@code instance-stale-ms} 넘게 끊긴 인스턴스의 세션 actor 를 내보낸다. {@code lastPinged} 가 없으면
     * 죽은 것으로 보는데, 이는 «{@code remoteSessions} 의 키는 늘 원격 JOIN 적용이 {@code lastPinged} 를 심은 뒤에만
     * 생긴다»는 순서에 기댄다 — 원격 JOIN 적용({@link #applyForwarded})이 유일한 생성 경로다.
     */
    private void sweepDeadInstances() {
        long now = System.nanoTime();
        for (Map.Entry<UUID, Set<String>> entry : remoteSessions.entrySet()) {
            entry.getValue().removeIf(sessionKey -> {
                Long heard = lastPinged.get(MovementRelay.instanceOf(sessionKey));
                if (heard != null && now - heard <= instanceStaleNanos) {
                    return false;
                }
                rooms.leave(entry.getKey(), sessionKey);
                return true;
            });
        }
    }

    // ── movement-relay-in 스레드 ────────────────────────────────────────

    /** 이 인스턴스 앞으로 오는 명령 채널(소유자별 PING). */
    public String ownCmdChannel() {
        return ownCmdChannel;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String channel = new String(message.getChannel(), StandardCharsets.UTF_8);
            if (RedisKeys.MOVEMENT_FRAMES_CHANNEL.equals(channel)) {
                onFrame(objectMapper.readValue(message.getBody(), Frame.class));
            } else if (RedisKeys.MOVEMENT_CMD_CHANNEL.equals(channel) || channel.equals(ownCmdChannel)) {
                onCommand(objectMapper.readValue(message.getBody(), Command.class));
            }
        } catch (RuntimeException e) {
            log.warn("이동 릴레이 수신 처리 실패 — reason={}", e.getClass().getSimpleName());
        }
    }

    void onFrame(Frame frame) {
        UUID islandId = frame.islandId();
        Long seen = seenEpochs.get(islandId);
        if (seen != null && frame.epoch() < seen) {
            relayStale.increment();
            return;
        }
        if (seen == null || frame.epoch() > seen) {
            seenEpochs.merge(islandId, frame.epoch(), Math::max);
            Owner owner = new Owner(frame.originInstanceId(), frame.epoch());
            submit(() -> observeOwner(islandId, owner));
        }
        if (frame.targetInstanceId() != null && !frame.targetInstanceId().equals(me)) {
            return;
        }
        switch (frame.kind()) {
            case EVENT -> {
                if (frame.resync() && frame.targetSessionId() != null) {
                    replaced.remove(replacedKey(islandId, frame.targetSessionId())); // 자기 FullState = actor 를 든 쪽이다
                }
                publisher.deliver(islandId, frame.payload().getBytes(StandardCharsets.UTF_8), frame.targetSessionId(),
                        frame.resync());
            }
            case SNAPSHOT -> publisher.deliverSnapshot(islandId, frame.payload().getBytes(StandardCharsets.UTF_8));
            case SUPERSEDE -> {
                replaced.add(replacedKey(islandId, frame.targetSessionId()));
                publisher.resync(islandId, frame.targetSessionId());
            }
            default -> {
            }
        }
    }

    void onCommand(Command command) {
        if (me.equals(command.originInstanceId())) {
            return; // 자기 메아리 — RECHECK 는 이미 로컬에서 했다.
        }
        // 내게 온 PING 만 생존으로 센다 — 남에게 간 PING·FULL_STATE 재시도 같은 다른 명령으로 갱신하면 PING 목록에서 빠진 유령이 안 지워진다.
        if (command.type() == Type.PING && (command.ownerInstanceId() == null
                || me.equals(command.ownerInstanceId()))) {
            lastPinged.put(command.originInstanceId(), System.nanoTime());
        }
        if (command.type() == Type.RECHECK) {
            MovementSubscriptionListener listener = listeners.getIfAvailable();
            if (listener != null) {
                listener.applyRemoteRecheck(command.islandId(), command.userId(), command.cacheStale());
            }
            return;
        }
        if (command.type() == Type.RESYNC) {
            Long seen = seenEpochs.get(command.islandId());
            if (seen != null && command.epoch() < seen) {
                staleEpoch.increment(); // 옛 소유자의 RESYNC — 새 소유자 아래 세션을 괜히 흔들지 않는다
                return;
            }
            submit(() -> resyncIsland(command.islandId()));
        } else if (command.type() == Type.PING) {
            // 수신자 null = 옛 버전·호환 PING(전원 대조). 남에게 간 PING 은 내 방 대조에 쓰지 않는다.
            if (command.ownerInstanceId() == null || me.equals(command.ownerInstanceId())) {
                submit(() -> reconcile(command.originInstanceId(), command.sessions()));
            }
        } else if (me.equals(command.ownerInstanceId())) {
            submit(command.type() == Type.EVICTED ? () -> rejoinEvicted(command.sessions())
                    : () -> applyForwarded(command));
        }
    }

    // ── PING 대조(codex P2 2건) — movement-cluster 스레드 ─────────────────

    /**
     * 이 인스턴스가 남의 방에 «입장해 있다고 믿는» 세션({@code 섬|세션}) — PING 에 실어 소유자가 대조한다. 내가 소유한 섬은
     * 로컬이라 뺀다. 소유자별로 묶어 그 소유자에게만 보낸다(소유자 채널) — 소유자를 모르는 섬은 뺀다({@code pendingRejoin} 이
     * 덮는다). ponytail: 1초마다 소유자별로 전부 싣는다(세션 수만큼 커진다). 커지면 섬별 해시로 줄인다.
     */
    private Map<String, List<String>> joinedSessionsByOwner() {
        Map<String, List<String>> joined = new HashMap<>();
        for (UUID islandId : publisher.islands()) {
            if (ownership.lease(islandId) != null) {
                continue;
            }
            for (MovementOutbox outbox : publisher.outboxes(islandId)) {
                Owner owner = owners.get(islandId);
                if (owner != null && eligible(islandId, outbox)) {
                    joined.computeIfAbsent(owner.instanceId(), k -> new ArrayList<>())
                            .add(replacedKey(islandId, outbox.sessionId()));
                }
            }
        }
        return joined;
    }

    /**
     * 소유자 쪽 대조 — {@code origin} 의 PING 목록과 내 방의 그 인스턴스 actor 를 맞춘다. 목록에 없는데 방에 있으면(LEAVE 유실)
     * 내보내고, 목록에 있는데 방에 없으면(JOIN 유실, 생존 신호가 끊겨 내가 내보낸 뒤 복구) {@code EVICTED} 로 알려 다시 입장하게
     * 한다. 명령과 같은 실행기·같은 순서(JOIN 이 PING 보다 먼저 나갔으면 먼저 적용됐다)라 아직 도착 전인 JOIN 을 잘못 세지 않는다.
     *
     * <p>비소유 쪽이 «자기 PING 이 끊겼다가 복구됨»을 따로 감지하지 않는 이유: 이 대조가 PING 마다(1초) 되풀이되므로 EVICTED 가
     * 한 번 유실돼도 다음 PING 이 다시 보낸다. 감지 장치를 하나 더 두면 같은 일을 두 곳이 한다.
     */
    private void reconcile(String origin, List<String> sessions) {
        Set<String> listed = sessions == null ? Set.of() : new HashSet<>(sessions);
        List<String> missing = new ArrayList<>();
        for (UUID islandId : ownership.leases().keySet()) {
            if (ownership.lease(islandId) == null) {
                continue;
            }
            Set<String> remote = remoteSessions.computeIfAbsent(islandId, id -> new HashSet<>());
            remote.removeIf(key -> {
                if (!MovementRelay.instanceOf(key).equals(origin)
                        || listed.contains(replacedKey(islandId, MovementRelay.sessionOf(key)))) {
                    return false;
                }
                rooms.leave(islandId, key);
                return true;
            });
            String prefix = islandId + "|";
            for (String entry : listed) {
                if (entry.startsWith(prefix)
                        && !remote.contains(MovementRelay.sessionKey(origin, entry.substring(prefix.length())))) {
                    missing.add(entry);
                }
            }
        }
        if (!missing.isEmpty()) {
            relay.publishCommand(new Command(me, origin, 0, null, Type.EVICTED, null, null, null, false, missing));
        }
    }

    /** 비소유 쪽 — 소유자가 «네 세션이 내 방에 없다»고 알렸다. 그 세션만 게이트를 닫고 다시 입장시킨다. */
    private void rejoinEvicted(List<String> sessions) {
        if (sessions == null) {
            return;
        }
        for (String entry : sessions) {
            int split = entry.indexOf('|');
            UUID islandId = UUID.fromString(entry.substring(0, split));
            String sessionId = entry.substring(split + 1);
            for (MovementOutbox outbox : publisher.outboxes(islandId)) {
                if (outbox.sessionId().equals(sessionId) && eligible(islandId, outbox)) {
                    publisher.resync(islandId, sessionId);
                    route(islandId, Type.JOIN, outbox.userId(), sessionId, null);
                    route(islandId, Type.FULL_STATE, null, sessionId, null);
                }
            }
        }
    }

    /**
     * 세션 한정 FullState 재요청(codex r1 P1) — JOIN 은 됐는데 FULL_STATE 명령이나 그 응답 프레임을 잃으면(줄 포화·PUBLISH
     * 실패) 그 세션은 게이트가 닫힌 채 남는다. PING 대조는 방에 actor 가 있으니 정상으로 보고, 전원 FullState 는 게이트를 열지
     * 못한다. 그래서 1초마다 «게이트가 닫힌 지(또는 요청한 지) {@link #FULL_STATE_RETRY_NANOS} 넘은» 내 세션의 FULL_STATE 를
     * 다시 보낸다(재요청이 시각을 다시 찍으므로 실제 주기는 약 2~3초) — 상한 없이(소유자가 바뀌면 재입장 경로가 대신한다). 소유자 쪽에 «대기 중» 표시를 싣는 안보다 작다: 게이트
     * 상태는 이쪽 outbox 만 안다. 멈춘(강퇴 재검사 중) 세션은 재개 때 처리기가 직접 요청하므로 뺀다.
     */
    private void retryFullStates() {
        long now = System.nanoTime();
        Set<String> waiting = new HashSet<>();
        for (UUID islandId : publisher.islands()) {
            for (MovementOutbox outbox : publisher.outboxes(islandId)) {
                if (!eligible(islandId, outbox) || !outbox.acceptsIntents() || !outbox.isAwaitingFullState()) {
                    continue;
                }
                String key = replacedKey(islandId, outbox.sessionId());
                waiting.add(key);
                Long since = fullStateRequestedAt.putIfAbsent(key, now);
                if (since != null && now - since >= FULL_STATE_RETRY_NANOS) {
                    fullStateRetried.increment();
                    route(islandId, Type.FULL_STATE, null, outbox.sessionId(), null);
                }
            }
        }
        fullStateRequestedAt.keySet().retainAll(waiting);
    }

    /**
     * 소유자 쪽 — reliable 프레임(퇴장 FullState·Arrived 등)을 잃은 섬에 RESYNC 를 돌린다(codex r2). 게이트가 이미 열린 세션은
     * {@link #retryFullStates} 대상이 아니고 PING 대조는 앱의 actor 목록을 모르므로, 그 프레임을 잃으면 다음 입퇴장까지 어긋난다.
     * 리스가 없으면 건너뛴다(새 소유자의 재입장이 같은 일을 한다).
     */
    private void requestResyncs() {
        for (UUID islandId : relay.takeResyncs()) {
            Lease lease = ownership.lease(islandId);
            if (lease == null) {
                continue;
            }
            relay.publishCommand(new Command(me, null, lease.epoch(), islandId, Type.RESYNC, null, null, null, false));
            resyncIsland(islandId); // 내 세션 — 자기 메아리는 받지 않는다
        }
    }

    /** 그 섬의 내 세션 전부 게이트를 닫고 세션 한정 FullState 를 다시 요청한다. */
    private void resyncIsland(UUID islandId) {
        for (MovementOutbox outbox : publisher.outboxes(islandId)) {
            if (eligible(islandId, outbox) && outbox.acceptsIntents()) {
                publisher.resync(islandId, outbox.sessionId());
                route(islandId, Type.FULL_STATE, null, outbox.sessionId(), null);
            }
        }
    }

    /** 방에 actor 를 든 내 세션인가 — 구독 중·안 닫힘·교체되지 않음. */
    private boolean eligible(UUID islandId, MovementOutbox outbox) {
        return outbox.hasMovement() && !outbox.isClosed() && !outbox.isSuperseded()
                && !replaced.contains(replacedKey(islandId, outbox.sessionId()));
    }

    private static String replacedKey(UUID islandId, String sessionId) {
        return islandId + "|" + sessionId;
    }
}

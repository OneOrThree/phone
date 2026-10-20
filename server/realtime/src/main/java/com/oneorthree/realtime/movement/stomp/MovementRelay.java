package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.movement.MoveIntent;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.RoomRuntime;
import com.oneorthree.realtime.movement.Target;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * 방 콜백({@link RoomRuntime.Listener})의 실제 수신자 — 플래그 OFF 면 {@link MovementPublisher} 로 그대로 넘기고(현행), ON
 * 이면 사건을 {@link Frame} 으로 싸서 {@code chat:movement:frames:v1} 에 낸다(GROMO-2339). 다른 인스턴스로 가는 명령
 * ({@link Command})도 같은 송신 줄을 탄다.
 *
 * <p><b>송신은 한 스레드·두 줄이다</b>({@code movement-relay-out}) — 사건·Snapshot·INTENT 줄({@link #QUEUE_CAPACITY})과
 * 제어 명령 줄({@link #CONTROL_CAPACITY}). 넣는 쪽은 넣기만 하고, 송신 스레드가 제어 줄부터 모아 파이프라인 PUBLISH 한다.
 * 한 연결이라 받는 쪽에서도 낸 순서 그대로 보인다(같은 줄 안에서. 제어가 앞선 INTENT 를 앞지를 수는 있다 — 퇴장 뒤 INTENT 는
 * 방이 버린다). 줄이 차면 버리고 {@code movement.relay.dropped{kind=frame|control}} 을 센다 — 틱을 막지 않는다. 잃은 사건은
 * 다음 FullState 가, 잃은 제어 명령은 1초 PING 대조가 덮는다.
 *
 * <p>소유자 리스가 없는 섬의 사건은 내지 않는다(fail-closed) — 리스를 잃은 직후 같은 틱에 한 번 더 돈 옛 방이 새 소유자
 * 위에 덮어쓰지 않게.
 */
@Slf4j
@Primary
@Component
public class MovementRelay implements RoomRuntime.Listener {

    static final int QUEUE_CAPACITY = 4096;
    /** 제어 명령 줄 — 사건·Snapshot·INTENT 와 따로 두고 먼저 낸다. 1초 PING 대조가 유실을 고치므로 작게 둔다. */
    static final int CONTROL_CAPACITY = 1024;
    private static final int BATCH = 256;

    private final boolean enabled;
    private final MovementPublisher publisher;
    private final MovementOwnership ownership;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final ArrayBlockingQueue<Outgoing> queue;
    private final ArrayBlockingQueue<Outgoing> control;
    private final Semaphore signal = new Semaphore(0);
    private final Counter dropped;
    private final Counter droppedControl;
    private final Counter resyncDropped;
    private final Counter resyncPublish;
    private final Set<UUID> needsResync = ConcurrentHashMap.newKeySet();
    private final Counter recheckDropped;
    private final Counter recheckPublish;
    private final Set<Command> pendingRechecks = ConcurrentHashMap.newKeySet();
    private final Counter noLease;
    private final Counter staleRoom;
    private final Counter staleQueue;
    private final Counter publishFailed;
    private final Timer lag;

    /**
     * 소유한 섬의 마지막으로 낸 위치(사용자 → 좌표) — 종료 인계(단계 B)에 쓴다. 틱 스레드가 쓰고 종료 스레드가 읽는다.
     * ponytail: Snapshot 마다 이동 중인 사람만 덮어쓴다(틱당 맵 put 몇 번). 걷던 사람은 인계 뒤 그 자리에 IDLE 로 선다.
     */
    private final Map<UUID, Map<UUID, MovementEvent.Point>> positions = new ConcurrentHashMap<>();

    private volatile boolean running;
    private Thread sender;

    @Autowired
    public MovementRelay(@Value("${realtime.movement.multi-instance.enabled:true}") boolean enabled,
            MovementPublisher publisher, MovementOwnership ownership, StringRedisTemplate redis,
            ObjectMapper objectMapper, MeterRegistry meterRegistry) {
        this(enabled, publisher, ownership, redis, objectMapper, meterRegistry, QUEUE_CAPACITY, CONTROL_CAPACITY);
    }

    /** 패키지 전용 — 테스트가 작은 줄로 포화를 만든다. */
    MovementRelay(boolean enabled, MovementPublisher publisher, MovementOwnership ownership,
            StringRedisTemplate redis, ObjectMapper objectMapper, MeterRegistry meterRegistry, int capacity,
            int controlCapacity) {
        this.enabled = enabled;
        this.publisher = publisher;
        this.ownership = ownership;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.queue = new ArrayBlockingQueue<>(capacity);
        this.control = new ArrayBlockingQueue<>(controlCapacity);
        Gauge.builder("movement.relay.queue.depth", this, relay -> relay.queue.size() + relay.control.size())
                .description("이동 릴레이 송신 줄 깊이(GROMO-2339, 상한 " + capacity + ")")
                .register(meterRegistry);
        this.dropped = Counter.builder("movement.relay.dropped").tag("kind", "frame")
                .description("사건 줄이 차서 버린 Snapshot·INTENT 수(버려도 되는 것만 이 줄에 있다)")
                .register(meterRegistry);
        this.droppedControl = Counter.builder("movement.relay.dropped").tag("kind", "control")
                .description("제어 줄까지 차서 버린 JOIN·LEAVE·FULL_STATE·RECHECK·PING 수 — 다음 PING 대조가 고친다")
                .register(meterRegistry);
        this.noLease = Counter.builder("movement.routing.failed").tag("reason", "no_lease")
                .description("소유자 리스 없이 나온 방 사건이라 내지 않은 수(fail-closed)")
                .register(meterRegistry);
        this.resyncDropped = Counter.builder("movement.relay.resync").tag("reason", "dropped")
                .description("제어 줄이 차서 reliable 프레임을 잃고 그 섬 재동기화를 건 수").register(meterRegistry);
        this.resyncPublish = Counter.builder("movement.relay.resync").tag("reason", "publish")
                .description("PUBLISH 실패로 reliable 프레임을 잃고 그 섬 재동기화를 건 수").register(meterRegistry);
        this.recheckDropped = Counter.builder("movement.relay.recheck.retry").tag("reason", "dropped")
                .description("제어 줄이 차서 RECHECK 를 못 넣고 다시 보내기로 한 수").register(meterRegistry);
        this.recheckPublish = Counter.builder("movement.relay.recheck.retry").tag("reason", "publish")
                .description("PUBLISH 실패로 RECHECK 를 잃고 다시 보내기로 한 수").register(meterRegistry);
        this.staleQueue = Counter.builder("movement.routing.failed").tag("reason", "stale_queue")
                .description("줄에 머무는 사이 리스·epoch 가 바뀐 프레임이라 PUBLISH 직전에 버린 수").register(meterRegistry);
        this.staleRoom = Counter.builder("movement.routing.failed").tag("reason", "stale_room")
                .description("리스를 잃었다 다시 얻은 뒤 옛 방에서 늦게 나온 사건이라 내지 않은 수(fail-closed)")
                .register(meterRegistry);
        this.publishFailed = Counter.builder("movement.routing.failed").tag("reason", "publish")
                .description("Redis PUBLISH 가 실패해 잃은 이동 프레임·명령 수")
                .register(meterRegistry);
        this.lag = Timer.builder("movement.relay.lag")
                .description("이동 릴레이 — 줄에 넣은 뒤 PUBLISH 가 끝날 때까지")
                .publishPercentileHistogram()
                .register(meterRegistry);
    }

    boolean enabled() {
        return enabled;
    }

    @PostConstruct
    void start() {
        if (!enabled || running) {
            return;
        }
        // stop() 이 2초 시간 초과로 끝나 옛 송신 스레드가 살아 있으면 하나 더 만들지 않는다(줄을 둘이 소비) — 더 기다린 뒤에도 살아 있으면 그것을 재사용한다.
        if (sender != null && sender.isAlive()) {
            try {
                sender.join(TimeUnit.SECONDS.toMillis(2));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            if (sender.isAlive()) {
                running = true;
                return;
            }
        }
        running = true;
        sender = new Thread(this::sendLoop, "movement-relay-out");
        sender.setDaemon(true);
        sender.start();
    }

    @PreDestroy
    void stop() {
        running = false;
        if (sender != null) {
            try {
                sender.join(TimeUnit.SECONDS.toMillis(2)); // 남은 줄을 마저 낸다(종료 직전 퇴장 FullState 등)
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    // ── 방 콜백(틱 스레드) ───────────────────────────────────────────────

    @Override
    public void onEvent(UUID islandId, MovementEvent event, Target target) {
        if (!enabled) {
            publisher.onEvent(islandId, event, target);
            return;
        }
        publishEvent(islandId, event, target, ownership.lease(islandId));
    }

    @Override
    public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        if (!enabled) {
            publisher.onSnapshot(islandId, snapshot);
            return;
        }
        publishSnapshot(islandId, snapshot, ownership.lease(islandId));
    }

    /**
     * 다른 인스턴스의 새 세션이 actor 를 가져갔다 — 옛 세션의 인스턴스에 SUPERSEDE 를 보낸다(N6). 같은 인스턴스끼리의 교체는
     * 그 인스턴스의 구독 처리기가 이미 했다(단일 인스턴스와 같은 경로). OFF 는 늘 그 경우라 아무것도 안 한다.
     */
    @Override
    public void onSessionReplaced(UUID islandId, String replacedSessionKey, String newSessionKey) {
        if (enabled) {
            publishReplaced(islandId, replacedSessionKey, newSessionKey, ownership.lease(islandId));
        }
    }

    /**
     * 방 하나에 묶인 콜백(codex r1 P2) — 방을 만들 때의 리스 세대를 쥐고, 지금 리스가 «그 세대»일 때만 낸다. 틱 스레드가 옛 방을
     * 처리하는 사이 클러스터 스레드가 리스를 잃고({@code evict}) 같은 섬을 다시 얻으면, 옛 방의 늦은 콜백이 새 리스(새 epoch,
     * 또는 같은 epoch 재획득)로 나가 받는 쪽 stale 필터를 통과한다 — 그걸 여기서 막는다({@code routing.failed{stale_room}}).
     * epoch 가 아니라 로컬 세대로 비교하는 이유: 상실 뒤 Redis 키가 아직 내 것이면 같은 epoch 로 다시 얻는다.
     */
    @Override
    public RoomRuntime.Listener forRoom(UUID islandId) {
        if (!enabled) {
            return this;
        }
        MovementOwnership.Lease creator = ownership.lease(islandId);
        long generation = creator == null ? -1 : creator.generation();
        return new RoomRuntime.Listener() {
            @Override
            public void onEvent(UUID id, MovementEvent event, Target target) {
                MovementOwnership.Lease lease = ownership.lease(id);
                if (sameRoom(lease, generation)) {
                    publishEvent(id, event, target, lease);
                }
            }

            @Override
            public void onSnapshot(UUID id, MovementEvent.Snapshot snapshot) {
                MovementOwnership.Lease lease = ownership.lease(id);
                if (sameRoom(lease, generation)) {
                    publishSnapshot(id, snapshot, lease);
                }
            }

            @Override
            public void onSessionReplaced(UUID id, String replacedSessionKey, String newSessionKey) {
                MovementOwnership.Lease lease = ownership.lease(id);
                if (sameRoom(lease, generation)) {
                    publishReplaced(id, replacedSessionKey, newSessionKey, lease);
                }
            }
        };
    }

    /** 리스가 없으면 아래 발행이 {@code no_lease} 로 센다. 있는데 세대가 다르면 옛 방이다. */
    private boolean sameRoom(MovementOwnership.Lease lease, long generation) {
        if (lease != null && lease.generation() != generation) {
            staleRoom.increment();
            return false;
        }
        return true;
    }

    private void publishEvent(UUID islandId, MovementEvent event, Target target, MovementOwnership.Lease lease) {
        if (lease == null) {
            noLease.increment();
            return;
        }
        remember(islandId, event);
        String payload = objectMapper.writeValueAsString(event);
        if (target instanceof Target.Only only) {
            String key = only.sessionKey();
            publishFrame(lease.generation(), new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.EVENT,
                    instanceOf(key), sessionOf(key), event instanceof MovementEvent.FullState, payload));
            return;
        }
        publishFrame(lease.generation(), new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.EVENT, null,
                null, false, payload));
    }

    private void publishSnapshot(UUID islandId, MovementEvent.Snapshot snapshot, MovementOwnership.Lease lease) {
        if (lease == null) {
            noLease.increment();
            return;
        }
        remember(islandId, snapshot);
        publishFrame(lease.generation(), new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.SNAPSHOT,
                null, null, false, objectMapper.writeValueAsString(snapshot)));
    }

    private void publishReplaced(UUID islandId, String replacedSessionKey, String newSessionKey,
            MovementOwnership.Lease lease) {
        if (instanceOf(replacedSessionKey).equals(instanceOf(newSessionKey))) {
            return;
        }
        if (lease == null) {
            noLease.increment();
            return;
        }
        publishFrame(lease.generation(), new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.SUPERSEDE,
                instanceOf(replacedSessionKey), sessionOf(replacedSessionKey), false, null));
    }

    private void remember(UUID islandId, MovementEvent event) {
        if (event instanceof MovementEvent.FullState state) {
            Map<UUID, MovementEvent.Point> known = positions.computeIfAbsent(islandId, id -> new ConcurrentHashMap<>());
            state.actors().forEach(a -> known.put(a.userId(), new MovementEvent.Point(a.x(), a.y())));
        } else if (event instanceof MovementEvent.Snapshot snapshot) {
            Map<UUID, MovementEvent.Point> known = positions.computeIfAbsent(islandId, id -> new ConcurrentHashMap<>());
            snapshot.entities().forEach(e -> known.put(e.userId(), new MovementEvent.Point(e.x(), e.y())));
        } else if (event instanceof MovementEvent.Arrived arrived) {
            positions.computeIfAbsent(islandId, id -> new ConcurrentHashMap<>())
                    .put(arrived.userId(), arrived.position());
        }
    }

    /** 인계용 — 그 섬에서 마지막으로 낸 위치들(복사본). */
    Map<UUID, MovementEvent.Point> positions(UUID islandId) {
        Map<UUID, MovementEvent.Point> known = positions.get(islandId);
        return known == null ? Map.of() : Map.copyOf(known);
    }

    void forget(UUID islandId) {
        positions.remove(islandId);
    }

    // ── 송신 줄 ─────────────────────────────────────────────────────────

    /**
     * 프레임을 낸다. 버려도 되는 건 Snapshot 뿐이다(다음 틱이 또 준다) — 사건 줄로 간다. reliable 사건(FullState·PathAccepted·
     * Arrived·MoveRejected)과 SUPERSEDE 는 제어 줄로 간다(codex r2): 사건 줄이 Snapshot 으로 차도 밀리지 않는다. 제어 줄은
     * 건수 상한(1024)이라 FullState 크기(15명·경로 포함 수 KB)와 무관하다 — 다 차도 수 MB 다. 그래도 차거나 PUBLISH 가 실패해
     * reliable 을 잃으면 그 섬에 «재동기화 필요»를 남긴다 — 다음 감시 틱에 {@code MovementCluster} 가 RESYNC 를 돌려 모든
     * 인스턴스의 그 섬 세션이 세션 한정 FullState 로 다시 맞춘다({@code movement.relay.resync{reason}}).
     *
     * <p>그 대가로 reliable 사건이 먼저 줄 선 Snapshot 을 앞지를 수 있다 — 두 토픽은 원래 세션 outbox 에서도 따로 줄 서므로
     * (reliable 덱·Snapshot 슬롯) 새 순서 관계가 생기지는 않는다.
     */
    /** 테스트 전용 — 리스를 «넣는 시점»에 읽어 세대가 «만든 시점»과 다를 수 있다. 프로덕션은 세대 인자 버전을 쓴다. */
    void publishFrame(Frame frame) {
        MovementOwnership.Lease lease = ownership.lease(frame.islandId());
        publishFrame(lease == null ? -1 : lease.generation(), frame);
    }

    /** @param generation 이 프레임을 만든 리스 세대 — PUBLISH 직전에 지금 세대와 맞춰 본다({@link #dropStaleFrames}) */
    void publishFrame(long generation, Frame frame) {
        String payload = objectMapper.writeValueAsString(frame);
        Outgoing out = new Outgoing(RedisKeys.MOVEMENT_FRAMES_CHANNEL, payload, System.nanoTime(),
                frame.kind() == Kind.SNAPSHOT ? null : frame.islandId(), null, frame.islandId(), generation);
        if (frame.kind() == Kind.SNAPSHOT) {
            offer(queue, dropped, out);
        } else {
            offer(control, null, out);
        }
    }

    /**
     * 명령을 낸다. INTENT 만 사건과 같은 줄이고(버려져도 사용자가 다시 누른다), 나머지(JOIN·LEAVE·FULL_STATE·RECHECK·PING·
     * EVICTED)는 제어 줄로 가 사건 줄이 Snapshot 으로 차도 밀리지 않고 먼저 나간다(codex P2). 제어 줄마저 차거나 PUBLISH 가
     * 실패해 JOIN·LEAVE 를 잃으면 다음 PING 대조({@code MovementCluster#reconcile})가 1초 안에 맞춘다 — 그래서 재전송 장부를
     * 따로 두지 않는다(더 작은 설계).
     */
    void publishCommand(Command command) {
        String payload = objectMapper.writeValueAsString(command);
        long now = System.nanoTime();
        // PING 은 소유자 채널로 — 채널이 하나면 N 구독자 전부가 모든 PING 을 받는다. 수신자 null(호환)은 전원 채널.
        String channel = command.type() == Type.PING && command.ownerInstanceId() != null
                ? RedisKeys.movementCmdChannel(command.ownerInstanceId()) : RedisKeys.MOVEMENT_CMD_CHANNEL;
        if (command.type() == Type.INTENT) {
            offer(queue, dropped, new Outgoing(channel, payload, now, null, null, null, 0));
        } else if (command.type() == Type.RESYNC) {
            // RESYNC 자신을 잃어도 다시 표시돼 다음 틱에 또 보낸다.
            offer(control, null, new Outgoing(channel, payload, now, command.islandId(), null, null, 0));
        } else if (command.type() == Type.RECHECK) {
            // 강퇴 사건은 한 노드만 받는다 — 다른 노드의 세션을 멈추는 길은 이 RECHECK 뿐이라 잃으면 성공할 때까지 다시 보낸다
            // (codex P1). PING 대조는 actor 존재만 맞추고 멤버십은 보지 않는다.
            offer(control, null, new Outgoing(channel, payload, now, null, command, null, 0));
        } else {
            offer(control, droppedControl, new Outgoing(channel, payload, now, null, null, null, 0));
        }
    }

    /**
     * @param resyncIsland 잃으면 재동기화해야 하는 섬(reliable 프레임·RESYNC), 아니면 null
     * @param recheck      잃으면 다시 보내야 하는 RECHECK, 아니면 null — 둘 다 null 이면 잃을 때 {@code drops} 를 센다
     */
    private void offer(ArrayBlockingQueue<Outgoing> target, Counter drops, Outgoing out) {
        if (target.offer(out)) {
            signal.release();
        } else if (out.resyncIsland() != null) {
            markResync(out.resyncIsland(), resyncDropped);
        } else if (out.recheck() != null) {
            markRecheck(out.recheck(), recheckDropped);
        } else {
            drops.increment();
        }
    }

    /**
     * PUBLISH 직전 재확인(#1180 claude r1) — 줄에 넣을 때 본 리스는 줄에 머무는 동안(포화·GC·RTT, 초 단위) 바뀔 수 있다. 옛
     * 소유자의 프레임이 새 소유자 획득 뒤에 나가면, 새 epoch 를 아직 못 본 인스턴스의 stale 필터를 통과한다. 그래서 프레임마다
     * 지금 리스가 없거나 «세대»가 다르면 여기서 버린다({@code routing.failed{stale_queue}}). epoch 가 아니라 세대로 보는 이유는
     * {@link #forRoom} 과 같다 — 줄에 머무는 사이 상실·재획득이 일어나도 Redis 키가 아직 내 값이면 epoch 가 같다. 같은 세대면
     * epoch 도 같다. 재동기화는 걸지 않는다 — 소유자가
     * 바뀌었으니 새 소유자의 재입장 경로가 맞춘다. 남는 창은 이 확인과 PUBLISH 사이(μs)뿐이다.
     */
    private void dropStaleFrames(List<Outgoing> batch) {
        batch.removeIf(out -> {
            if (out.frameIsland() == null) {
                return false;
            }
            MovementOwnership.Lease lease = ownership.lease(out.frameIsland());
            if (lease != null && lease.generation() == out.frameGeneration()) {
                return false;
            }
            staleQueue.increment();
            return true;
        });
    }

    private void markRecheck(Command recheck, Counter reason) {
        reason.increment();
        pendingRechecks.add(recheck);
    }

    /** 잃은 RECHECK 를 꺼낸다(꺼낸 것은 지운다) — {@code movement-cluster} 감시가 1초마다 다시 보낸다. */
    Set<Command> takeRechecks() {
        Set<Command> taken = new HashSet<>();
        for (Command recheck : pendingRechecks) {
            if (pendingRechecks.remove(recheck)) {
                taken.add(recheck);
            }
        }
        return taken;
    }

    private void markResync(UUID islandId, Counter reason) {
        reason.increment();
        needsResync.add(islandId);
    }

    /** 재동기화가 필요한 섬을 꺼낸다(꺼낸 것은 지운다) — {@code movement-cluster} 감시가 1초마다 부른다. */
    Set<UUID> takeResyncs() {
        Set<UUID> taken = new HashSet<>();
        for (UUID islandId : needsResync) {
            if (needsResync.remove(islandId)) {
                taken.add(islandId);
            }
        }
        return taken;
    }

    private void sendLoop() {
        List<Outgoing> batch = new ArrayList<>(BATCH);
        while (running || !queue.isEmpty() || !control.isEmpty()) {
            try {
                if (!signal.tryAcquire(200, TimeUnit.MILLISECONDS) && control.isEmpty() && queue.isEmpty()) {
                    continue; // 할 일 없음 — running 을 다시 본다
                }
                signal.drainPermits();
                // 제어 줄을 먼저 비운다 — 한 배치 안에서도 제어가 앞선다.
                control.drainTo(batch, BATCH);
                queue.drainTo(batch, BATCH - batch.size());
                dropStaleFrames(batch);
                if (!batch.isEmpty()) {
                    send(batch);
                }
                if (!control.isEmpty() || !queue.isEmpty()) {
                    signal.release(); // 다 못 비웠다 — 기다리지 말고 다음 배치
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException e) {
                publishFailed.increment(batch.size());
                for (Outgoing lost : batch) {
                    if (lost.resyncIsland() != null) {
                        markResync(lost.resyncIsland(), resyncPublish);
                    }
                    if (lost.recheck() != null) {
                        markRecheck(lost.recheck(), recheckPublish);
                    }
                }
                log.warn("이동 릴레이 PUBLISH 실패 — {}건을 잃었다. reason={}", batch.size(), e.getClass().getSimpleName());
            } finally {
                batch.clear();
            }
        }
    }

    private void send(List<Outgoing> batch) {
        redis.executePipelined((RedisCallback<Object>) connection -> {
            for (Outgoing out : batch) {
                connection.publish(out.channel().getBytes(StandardCharsets.UTF_8),
                        out.payload().getBytes(StandardCharsets.UTF_8));
            }
            return null;
        });
        long now = System.nanoTime();
        for (Outgoing out : batch) {
            lag.record(now - out.enqueuedNanos(), TimeUnit.NANOSECONDS);
        }
    }

    // ── 세션 키 ─────────────────────────────────────────────────────────

    /** {@code <instanceId>:<sessionId>} — 다중 인스턴스에서 방이 아는 세션 이름. instanceId 에는 {@code :} 가 없다. */
    static String sessionKey(String instanceId, String sessionId) {
        return instanceId + ":" + sessionId;
    }

    static String instanceOf(String sessionKey) {
        int split = sessionKey.indexOf(':');
        return split < 0 ? "" : sessionKey.substring(0, split);
    }

    static String sessionOf(String sessionKey) {
        return sessionKey.substring(sessionKey.indexOf(':') + 1);
    }

    /** {@code frameIsland}·{@code frameGeneration} — 프레임이면 낸 섬과 만든 리스 세대(PUBLISH 직전 재확인용), 명령이면 null·0. */
    private record Outgoing(String channel, String payload, long enqueuedNanos, UUID resyncIsland, Command recheck,
            UUID frameIsland, long frameGeneration) {
    }

    // ── 봉투(wire 아님 — 인스턴스 사이 전용) ───────────────────────────

    /** 프레임 종류 — 사건(reliable)·위치 Snapshot·교체 통지. */
    public enum Kind { EVENT, SNAPSHOT, SUPERSEDE }

    /**
     * 명령 종류. {@code PING}·{@code EVICTED} 는 계약 §4 밖의 추가다. PING = 인스턴스 생존 신호(1초) + 그 인스턴스가 «입장해
     * 있다고 믿는» 세션 목록({@code sessions}, {@code 섬|세션}) — 소유자는 끊긴 인스턴스의 actor 를 내보내고, 목록과 대조해
     * 유령(LEAVE 유실)은 내보내고 빠진 세션(JOIN 유실·생존 신호 단절로 제거됨)은 {@code EVICTED}({@code ownerInstanceId} =
     * 받을 인스턴스)로 알려 다시 입장시킨다. {@code RESYNC}(역시 추가) = 소유자가 reliable 프레임을 잃었다 — 모든 인스턴스가
     * 그 섬의 자기 세션을 세션 한정 FullState 로 다시 맞춘다.
     */
    public enum Type { JOIN, LEAVE, INTENT, FULL_STATE, RECHECK, PING, EVICTED, RESYNC }

    /**
     * 소유자 → 전 인스턴스. {@code payload} 는 앱 wire 그대로의 사건 JSON(받는 쪽이 바이트로 바꿔 outbox 에 넣는다 —
     * 단일 인스턴스와 같은 바이트). {@code target*} 이 있으면 그 인스턴스의 그 세션만. {@code resync} = 그 세션 한정
     * FullState(송신 게이트를 연다).
     */
    public record Frame(String originInstanceId, UUID islandId, long epoch, Kind kind, String targetInstanceId,
            String targetSessionId, boolean resync, String payload) {
    }

    /**
     * 비소유 인스턴스 → 소유자({@code ownerInstanceId}·{@code epoch} 가 그 소유자를 가리킬 때만 적용). RECHECK·PING 은
     * {@code ownerInstanceId=null} 로 전원에게. {@code sessionKey} = {@code <originInstanceId>:<sessionId>}.
     */
    public record Command(String originInstanceId, String ownerInstanceId, long epoch, UUID islandId, Type type,
            UUID userId, String sessionKey, MoveIntent intent, boolean cacheStale, List<String> sessions) {

        public Command(String originInstanceId, String ownerInstanceId, long epoch, UUID islandId, Type type,
                UUID userId, String sessionKey, MoveIntent intent, boolean cacheStale) {
            this(originInstanceId, ownerInstanceId, epoch, islandId, type, userId, sessionKey, intent, cacheStale,
                    null);
        }
    }
}

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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 방 콜백({@link RoomRuntime.Listener})의 실제 수신자 — 플래그 OFF 면 {@link MovementPublisher} 로 그대로 넘기고(현행), ON
 * 이면 사건을 {@link Frame} 으로 싸서 {@code chat:movement:frames:v1} 에 낸다(GROMO-2339). 다른 인스턴스로 가는 명령
 * ({@link Command})도 같은 송신 줄을 탄다.
 *
 * <p><b>송신은 한 줄·한 스레드다</b>({@code movement-relay-out}) — 틱 스레드는 {@link ArrayBlockingQueue}({@link
 * #QUEUE_CAPACITY})에 넣기만 하고, 송신 스레드가 모아서 파이프라인 PUBLISH 한다. 한 연결·한 순서라 받는 쪽에서도 낸 순서
 * 그대로 보인다(Redis Pub/Sub 은 연결 단위 순서를 지킨다). 줄이 차면 그 건은 버리고 {@code movement.relay.dropped} 를
 * 센다 — 틱을 막지 않는다. 잃은 사건은 다음 입장·재동기화 FullState 가 덮는다.
 *
 * <p>소유자 리스가 없는 섬의 사건은 내지 않는다(fail-closed) — 리스를 잃은 직후 같은 틱에 한 번 더 돈 옛 방이 새 소유자
 * 위에 덮어쓰지 않게.
 */
@Slf4j
@Primary
@Component
public class MovementRelay implements RoomRuntime.Listener {

    static final int QUEUE_CAPACITY = 4096;
    private static final int BATCH = 256;

    private final boolean enabled;
    private final MovementPublisher publisher;
    private final MovementOwnership ownership;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final ArrayBlockingQueue<Outgoing> queue;
    private final Counter dropped;
    private final Counter noLease;
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
    public MovementRelay(@Value("${realtime.movement.multi-instance.enabled:false}") boolean enabled,
            MovementPublisher publisher, MovementOwnership ownership, StringRedisTemplate redis,
            ObjectMapper objectMapper, MeterRegistry meterRegistry) {
        this(enabled, publisher, ownership, redis, objectMapper, meterRegistry, QUEUE_CAPACITY);
    }

    /** 패키지 전용 — 테스트가 작은 줄로 포화를 만든다. */
    MovementRelay(boolean enabled, MovementPublisher publisher, MovementOwnership ownership,
            StringRedisTemplate redis, ObjectMapper objectMapper, MeterRegistry meterRegistry, int capacity) {
        this.enabled = enabled;
        this.publisher = publisher;
        this.ownership = ownership;
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.queue = new ArrayBlockingQueue<>(capacity);
        Gauge.builder("movement.relay.queue.depth", queue, ArrayBlockingQueue::size)
                .description("이동 릴레이 송신 줄 깊이(GROMO-2339, 상한 " + capacity + ")")
                .register(meterRegistry);
        this.dropped = Counter.builder("movement.relay.dropped")
                .description("송신 줄이 차서 버린 이동 프레임·명령 수")
                .register(meterRegistry);
        this.noLease = Counter.builder("movement.routing.failed").tag("reason", "no_lease")
                .description("소유자 리스 없이 나온 방 사건이라 내지 않은 수(fail-closed)")
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
        if (!enabled) {
            return;
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
        MovementOwnership.Lease lease = ownership.lease(islandId);
        if (lease == null) {
            noLease.increment();
            return;
        }
        remember(islandId, event);
        String payload = objectMapper.writeValueAsString(event);
        if (target instanceof Target.Only only) {
            String key = only.sessionKey();
            publishFrame(new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.EVENT, instanceOf(key),
                    sessionOf(key), event instanceof MovementEvent.FullState, payload));
            return;
        }
        publishFrame(new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.EVENT, null, null, false,
                payload));
    }

    @Override
    public void onSnapshot(UUID islandId, MovementEvent.Snapshot snapshot) {
        if (!enabled) {
            publisher.onSnapshot(islandId, snapshot);
            return;
        }
        MovementOwnership.Lease lease = ownership.lease(islandId);
        if (lease == null) {
            noLease.increment();
            return;
        }
        remember(islandId, snapshot);
        publishFrame(new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.SNAPSHOT, null, null, false,
                objectMapper.writeValueAsString(snapshot)));
    }

    /**
     * 다른 인스턴스의 새 세션이 actor 를 가져갔다 — 옛 세션의 인스턴스에 SUPERSEDE 를 보낸다(N6). 같은 인스턴스끼리의 교체는
     * 그 인스턴스의 구독 처리기가 이미 했다(단일 인스턴스와 같은 경로). OFF 는 늘 그 경우라 아무것도 안 한다.
     */
    @Override
    public void onSessionReplaced(UUID islandId, String replacedSessionKey, String newSessionKey) {
        if (!enabled || instanceOf(replacedSessionKey).equals(instanceOf(newSessionKey))) {
            return;
        }
        MovementOwnership.Lease lease = ownership.lease(islandId);
        if (lease == null) {
            noLease.increment();
            return;
        }
        publishFrame(new Frame(ownership.instanceId(), islandId, lease.epoch(), Kind.SUPERSEDE,
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

    void publishFrame(Frame frame) {
        offer(RedisKeys.MOVEMENT_FRAMES_CHANNEL, objectMapper.writeValueAsString(frame));
    }

    void publishCommand(Command command) {
        offer(RedisKeys.MOVEMENT_CMD_CHANNEL, objectMapper.writeValueAsString(command));
    }

    private void offer(String channel, String payload) {
        if (!queue.offer(new Outgoing(channel, payload, System.nanoTime()))) {
            dropped.increment();
        }
    }

    private void sendLoop() {
        List<Outgoing> batch = new ArrayList<>(BATCH);
        while (running || !queue.isEmpty()) {
            try {
                Outgoing first = queue.poll(200, TimeUnit.MILLISECONDS);
                if (first == null) {
                    continue;
                }
                batch.add(first);
                queue.drainTo(batch, BATCH - 1);
                send(batch);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException e) {
                publishFailed.increment(batch.size());
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

    private record Outgoing(String channel, String payload, long enqueuedNanos) {
    }

    // ── 봉투(wire 아님 — 인스턴스 사이 전용) ───────────────────────────

    /** 프레임 종류 — 사건(reliable)·위치 Snapshot·교체 통지. */
    public enum Kind { EVENT, SNAPSHOT, SUPERSEDE }

    /**
     * 명령 종류. {@code PING} 은 계약 §4 밖의 추가다 — 인스턴스 생존 신호(1초). 소유자는 끊긴 인스턴스의 세션 actor 를
     * 내보낸다(그 인스턴스가 죽으면 LEAVE 를 보낼 곳이 없다).
     */
    public enum Type { JOIN, LEAVE, INTENT, FULL_STATE, RECHECK, PING }

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
            UUID userId, String sessionKey, MoveIntent intent, boolean cacheStale) {
    }
}

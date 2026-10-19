package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.common.redis.RedisKeys;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 섬 이동 방의 소유자 리스(GROMO-2339) — 한 섬의 {@code RoomRuntime} 은 클러스터 전체에서 이 리스를 든 인스턴스 한 곳에만 산다.
 *
 * <p>키 {@code movement:owner:{islandId}} = {@code <instanceId>:<epoch>}, PX {@link #LEASE_MS}. 소유자는
 * {@code MovementCluster} 의 1초 주기로 갱신한다. epoch 는 전역 카운터 {@code movement:epoch} 에서
 * {@code max(직전+1, Redis TIME ms)} 로 받는다 — 카운터가 지워져도(flush) 시각 덕분에 옛 epoch 아래로 내려가지 않는다.
 * 받는 쪽은 그 섬에서 본 가장 큰 epoch 보다 작은 프레임을 버린다(옛 소유자의 늦은 프레임 차단).
 *
 * <p>세 스크립트 모두 «읽고 비교하고 쓰기»를 한 번에 한다 — 따로 하면 두 인스턴스가 같은 빈 키를 보고 둘 다 소유자가 된다.
 * 리스 상태({@link #leases})는 {@code movement-cluster} 스레드만 고친다. 다른 스레드(틱 — 릴레이 발행)는 읽기만 한다.
 */
@Component
public class MovementOwnership {

    /** 리스 수명. 갱신은 1초마다라 두 번 놓쳐도 산다. */
    static final long LEASE_MS = 3000;

    /**
     * 비어 있으면 새 epoch 로 내가 갖고, 차 있으면 그대로 돌려준다(내 것이면 수명도 늘린다). 반환 = 지금의 소유자 값.
     * KEYS: owner, epoch. ARGV: instanceId, leaseMs. epoch 는 2^53 아래 정수라 {@code %.0f} 로 적어야 지수 표기가 안 된다.
     */
    static final RedisScript<String> ACQUIRE = new DefaultRedisScript<>("""
            local cur = redis.call('GET', KEYS[1])
            if cur then
              if string.sub(cur, 1, #ARGV[1] + 1) == ARGV[1] .. ':' then
                redis.call('PEXPIRE', KEYS[1], ARGV[2])
              end
              return cur
            end
            local t = redis.call('TIME')
            local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
            local last = tonumber(redis.call('GET', KEYS[2]) or '0')
            local epoch = string.format('%.0f', math.max(last + 1, now))
            redis.call('SET', KEYS[2], epoch)
            local value = ARGV[1] .. ':' .. epoch
            redis.call('SET', KEYS[1], value, 'PX', ARGV[2])
            return value
            """, String.class);

    /** 값이 그대로 내 것일 때만 수명을 늘린다. KEYS: owner. ARGV: value, leaseMs. */
    static final RedisScript<Long> RENEW = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then
              return redis.call('PEXPIRE', KEYS[1], ARGV[2])
            end
            return 0
            """, Long.class);

    /** 값이 그대로 내 것일 때만 지운다 — 이미 남이 가져갔으면 건드리지 않는다. KEYS: owner. ARGV: value. */
    static final RedisScript<Long> RELEASE = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then
              return redis.call('DEL', KEYS[1])
            end
            return 0
            """, Long.class);

    private final StringRedisTemplate redis;
    private final String instanceId;
    private final long leaseMs;
    private final Map<UUID, Lease> leases = new ConcurrentHashMap<>();

    @Autowired
    public MovementOwnership(StringRedisTemplate redis, MeterRegistry meterRegistry) {
        this(redis, meterRegistry, newInstanceId(), LEASE_MS);
    }

    /** 패키지 전용 — 테스트가 인스턴스 id 와 짧은 리스 수명을 준다. */
    MovementOwnership(StringRedisTemplate redis, MeterRegistry meterRegistry, String instanceId, long leaseMs) {
        this.redis = redis;
        this.instanceId = instanceId;
        this.leaseMs = leaseMs;
        Gauge.builder("movement.owner.islands", leases, Map::size)
                .description("이 인스턴스가 소유자 리스를 든 섬 수(GROMO-2339)")
                .register(meterRegistry);
    }

    /** 이 프로세스의 id — 세션 키({@code <instanceId>:<sessionId>})와 리스 값의 앞부분. {@code :} 를 담지 않는다. */
    public String instanceId() {
        return instanceId;
    }

    /**
     * 리스를 얻거나 지금 소유자를 알아낸다. 내 것이면 {@link #leases} 에 담는다.
     *
     * @return 지금 소유자(나일 수도 있다)
     */
    Owner acquire(UUID islandId) {
        String value = redis.execute(ACQUIRE, List.of(RedisKeys.movementOwner(islandId), RedisKeys.MOVEMENT_EPOCH),
                instanceId, Long.toString(leaseMs));
        Owner owner = Owner.parse(value);
        if (owner.instanceId().equals(instanceId)) {
            long now = System.nanoTime();
            Lease held = leases.get(islandId);
            leases.put(islandId, held != null && held.owner().equals(owner) ? held.renewed(now)
                    : new Lease(owner, now, now));
        }
        return owner;
    }

    /** @return 아직 내 것이라 늘렸으면 true. false 면 남이 가져갔거나 만료됐다 — 호출자가 잃은 것으로 처리한다 */
    boolean renew(UUID islandId) {
        Lease lease = leases.get(islandId);
        if (lease == null) {
            return false;
        }
        Long renewed = redis.execute(RENEW, List.of(RedisKeys.movementOwner(islandId)), lease.owner().value(),
                Long.toString(leaseMs));
        if (renewed != null && renewed == 1L) {
            leases.put(islandId, lease.renewed(System.nanoTime()));
            return true;
        }
        return false;
    }

    /** 리스를 내놓는다(내 값일 때만 DEL). 로컬 기록은 결과와 무관하게 지운다. */
    void release(UUID islandId) {
        Lease lease = leases.remove(islandId);
        if (lease != null) {
            redis.execute(RELEASE, List.of(RedisKeys.movementOwner(islandId)), lease.owner().value());
        }
    }

    /** 로컬 기록만 지운다 — 리스를 잃었을 때(Redis 는 이미 남의 것이거나 닿지 않는다). */
    void forget(UUID islandId) {
        leases.remove(islandId);
    }

    /** 내가 든 리스, 없으면 null. 틱 스레드(릴레이 발행)도 읽는다. */
    Lease lease(UUID islandId) {
        return leases.get(islandId);
    }

    /** 내가 든 리스 전부(복사본) — 갱신·인계가 훑는다. */
    Map<UUID, Lease> leases() {
        return Map.copyOf(leases);
    }

    private static String newInstanceId() {
        String host = System.getenv("HOSTNAME");
        String prefix = host == null ? "realtime" : host.replaceAll("[^A-Za-z0-9._-]", "");
        return (prefix.isEmpty() ? "realtime" : prefix) + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    /** 리스 값 {@code <instanceId>:<epoch>}. instanceId 에 {@code :} 가 없어 마지막 {@code :} 로 가른다. */
    record Owner(String instanceId, long epoch) {

        static Owner parse(String value) {
            int split = value.lastIndexOf(':');
            return new Owner(value.substring(0, split), Long.parseLong(value.substring(split + 1)));
        }

        String value() {
            return instanceId + ":" + epoch;
        }
    }

    /** 내가 든 리스 — {@code renewedAtNanos} 는 마지막으로 Redis 가 «아직 내 것»이라 답한 시각. */
    record Lease(Owner owner, long acquiredAtNanos, long renewedAtNanos) {

        long epoch() {
            return owner.epoch();
        }

        Lease renewed(long nowNanos) {
            return new Lease(owner, acquiredAtNanos, nowNanos);
        }
    }
}

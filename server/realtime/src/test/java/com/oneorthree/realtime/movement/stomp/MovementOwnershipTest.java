package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.RestrictedRedisTestcontainersConfiguration;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.Target;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 소유자 리스 Lua 셋(GROMO-2339)을 실 Redis 로 — 원자성·epoch 단조·만료 뒤 재획득·남의 갱신/반납 거절.
 * 리스 수명만 짧게(테스트 생성자) 주고 스크립트·키는 운영 그대로다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(RestrictedRedisTestcontainersConfiguration.class)
class MovementOwnershipTest {

    @Autowired
    private StringRedisTemplate redis;

    private MovementOwnership instance(String id, long leaseMs) {
        return new MovementOwnership(redis, new SimpleMeterRegistry(), id, leaseMs);
    }

    @Test
    @DisplayName("빈 리스는 먼저 온 쪽이 갖고, 뒤에 온 쪽은 그 소유자 값을 돌려받는다(소유자가 되지 않는다)")
    void firstAcquirerOwnsAndSecondLearnsTheOwner() {
        MovementOwnership a = instance("own-a", 3000);
        MovementOwnership b = instance("own-b", 3000);
        UUID island = UUID.randomUUID();

        MovementOwnership.Owner first = a.acquire(island);
        MovementOwnership.Owner second = b.acquire(island);

        assertThat(first.instanceId()).isEqualTo("own-a");
        assertThat(second).isEqualTo(first);
        assertThat(a.lease(island)).isNotNull();
        assertThat(b.lease(island)).isNull();
        assertThat(redis.opsForValue().get(RedisKeys.movementOwner(island))).isEqualTo(first.value());
        assertThat(redis.getExpire(RedisKeys.movementOwner(island))).isPositive();
    }

    @Test
    @DisplayName("만료 뒤엔 다른 인스턴스가 더 큰 epoch 로 재획득하고, 옛 소유자의 RENEW·RELEASE 는 거절된다")
    void expiredLeaseIsTakenOverAndTheOldOwnerIsRefused() throws Exception {
        MovementOwnership a = instance("exp-a", 200);
        MovementOwnership b = instance("exp-b", 3000);
        UUID island = UUID.randomUUID();
        MovementOwnership.Owner old = a.acquire(island);

        Thread.sleep(400); // a 의 리스(200ms) 만료
        MovementOwnership.Owner taken = b.acquire(island);

        assertThat(taken.instanceId()).isEqualTo("exp-b");
        assertThat(taken.epoch()).as("epoch 는 단조 증가").isGreaterThan(old.epoch());
        assertThat(a.renew(island)).as("남의 값이 된 리스는 늘리지 못한다").isFalse();
        a.release(island);
        assertThat(redis.opsForValue().get(RedisKeys.movementOwner(island)))
                .as("옛 소유자의 반납이 새 소유자를 지우지 않는다").isEqualTo(taken.value());
        assertThat(b.renew(island)).isTrue();
        b.release(island);
        assertThat(redis.hasKey(RedisKeys.movementOwner(island))).isFalse();
    }

    @Test
    @DisplayName("epoch 는 섬을 가로질러 단조 증가하고, 카운터가 지워져도(flush) 시각 덕분에 뒤로 가지 않는다")
    void epochIsMonotonicEvenAfterTheCounterIsLost() {
        MovementOwnership a = instance("mono-a", 3000);
        long previous = 0;
        for (int i = 0; i < 20; i++) {
            long epoch = a.acquire(UUID.randomUUID()).epoch();
            assertThat(epoch).isGreaterThan(previous);
            previous = epoch;
        }
        redis.delete(RedisKeys.MOVEMENT_EPOCH);
        assertThat(a.acquire(UUID.randomUUID()).epoch())
                .as("TIME ms 기반이라 카운터를 잃어도 옛 값 근처(같은 ms 안의 +1 들만 차이)에서 다시 시작한다")
                .isGreaterThanOrEqualTo(previous - 1000);
        assertThat(redis.getExpire(RedisKeys.MOVEMENT_EPOCH)).as("카운터에는 TTL 이 없다").isEqualTo(-1L);
    }

    @Test
    @DisplayName("두 인스턴스가 같은 섬 50개를 동시에 얻으려 해도 섬마다 소유자는 정확히 하나다(원자성)")
    void concurrentAcquireYieldsExactlyOneOwnerPerIsland() throws Exception {
        MovementOwnership a = instance("race-a", 3000);
        MovementOwnership b = instance("race-b", 3000);
        List<UUID> islands = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            islands.add(UUID.randomUUID());
        }
        Map<UUID, MovementOwnership.Owner> seenByA = new ConcurrentHashMap<>();
        Map<UUID, MovementOwnership.Owner> seenByB = new ConcurrentHashMap<>();
        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Future<?>> futures = new ArrayList<>();
        for (UUID island : islands) {
            futures.add(pool.submit(() -> {
                go.await();
                seenByA.put(island, a.acquire(island));
                return null;
            }));
            futures.add(pool.submit(() -> {
                go.await();
                seenByB.put(island, b.acquire(island));
                return null;
            }));
        }
        go.countDown();
        for (Future<?> future : futures) {
            future.get();
        }
        pool.shutdown();

        for (UUID island : islands) {
            assertThat(seenByA.get(island)).as("두 쪽이 본 소유자가 같다").isEqualTo(seenByB.get(island));
            boolean ownedByA = a.lease(island) != null;
            boolean ownedByB = b.lease(island) != null;
            assertThat(ownedByA ^ ownedByB).as("정확히 한 쪽만 리스를 든다").isTrue();
        }
    }

    @Test
    @DisplayName("갱신이 멈추면 로컬 한도(수명의 9/10) 뒤엔 리스를 믿지 않는다 — 2.6초는 유효, 3.0초는 무효·발행 0건(codex P1)")
    void staleLocalLeaseStopsPublishing() {
        AtomicLong clock = new AtomicLong(0);
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        MovementOwnership a = new MovementOwnership(redis, meters, "clk-a", 3000, clock::get);
        ObjectMapper json = JsonMapper.builder().build();
        MovementPublisher publisher = new MovementPublisher(json, new RealtimeSessionRegistry(), meters,
                (message, timeout) -> true);
        MovementRelay relay = new MovementRelay(true, publisher, a, redis, json, meters, 16, 16); // 송신 스레드 없음
        UUID island = UUID.randomUUID();
        MovementEvent.FullState state = new MovementEvent.FullState(1, 1, 50, 10.989, List.of());
        a.acquire(island);

        clock.set(TimeUnit.MILLISECONDS.toNanos(2600));
        assertThat(a.lease(island)).isNotNull();
        relay.onEvent(island, state, Target.ALL);
        assertThat(meters.get("movement.relay.queue.depth").gauge().value()).isEqualTo(1);

        clock.set(TimeUnit.MILLISECONDS.toNanos(3000));
        assertThat(a.lease(island)).as("Redis 가 아직 내 것이라 해도 로컬 한도를 넘기면 믿지 않는다").isNull();
        relay.onEvent(island, state, Target.ALL);
        relay.onSnapshot(island, new MovementEvent.Snapshot(1, 1, List.of()));
        assertThat(meters.get("movement.relay.queue.depth").gauge().value()).as("발행 0건").isEqualTo(1);
        assertThat(meters.counter("movement.routing.failed", "reason", "no_lease").count()).isEqualTo(2);

        assertThat(a.renew(island)).as("갱신이 성공하면 다시 믿는다").isTrue();
        assertThat(a.lease(island)).isNotNull();
        a.release(island);
    }
}

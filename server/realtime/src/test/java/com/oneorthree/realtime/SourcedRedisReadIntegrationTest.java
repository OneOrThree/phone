package com.oneorthree.realtime;

import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.common.redis.Sourced;
import com.oneorthree.realtime.membership.MembershipService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 원본 값과 그 만료를 한 원자 단위(Lua GET+PTTL)로 읽는 두 자리 — 실제 Redis 로 매핑을 본다(GROMO-2340).
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class SourcedRedisReadIntegrationTest {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private MembershipService membershipService;

    @Test
    @DisplayName("멤버십: 값과 그 값의 PTTL 을 함께 — 키 없음 EXPIRED, 수명 없음 UNBOUNDED, 갈린 뒤 읽으면 새 값과 새 수명")
    void membershipValueAndExpiryAreReadTogether() {
        UUID user = UUID.randomUUID();
        UUID island = UUID.randomUUID();
        String key = RedisKeys.memberCache(user);
        try {
            assertThat(membershipService.cachedGroupIdsSourced(user).expiresAtNanos()).isEqualTo(Sourced.EXPIRED);

            redis.opsForValue().set(key, island.toString(), Duration.ofSeconds(1));
            long before = System.nanoTime();
            Sourced<Set<UUID>> judged = membershipService.cachedGroupIdsSourced(user);
            long after = System.nanoTime();
            assertThat(judged.value()).containsExactly(island);
            // PTTL 은 ms 단위로 내려온다 — 상한은 읽기가 끝난 시각 + 1s(정밀 대조가 아니라 «그 값의 1s 수명»을 본다).
            assertThat(judged.expiresAtNanos()).isBetween(before, after + TimeUnit.SECONDS.toNanos(1));

            redis.opsForValue().set(key, "", Duration.ofSeconds(120)); // 원본이 비멤버 새 값·새 TTL 로 갈렸다
            Sourced<Set<UUID>> replaced = membershipService.cachedGroupIdsSourced(user);
            assertThat(replaced.value()).isEmpty();
            assertThat(replaced.expiresAtNanos()).isGreaterThan(judged.expiresAtNanos());

            redis.opsForValue().set(key, island.toString());
            assertThat(membershipService.cachedGroupIdsSourced(user).expiresAtNanos()).isEqualTo(Sourced.UNBOUNDED);
        } finally {
            redis.delete(key);
        }
    }

    @Test
    @DisplayName("차단: 캐시 hit 은 집합과 그 PTTL 을 함께, 세대가 다르면 hit 가 아니다")
    void blockSetAndExpiryAreReadTogether() {
        UUID viewer = UUID.randomUUID();
        UUID stale = UUID.randomUUID();
        UUID blocked = UUID.randomUUID();
        BlockClient client = mock(BlockClient.class);
        BlockedUsers filter = new BlockedUsers(client, redis, 120, true);
        try {
            redis.opsForValue().set(RedisKeys.blockCache(viewer), "0|" + blocked, Duration.ofSeconds(1));
            long before = System.nanoTime();
            Sourced<Boolean> judged = filter.hasBlockedSourced(viewer, blocked);
            long after = System.nanoTime();
            assertThat(judged.value()).isTrue();
            assertThat(judged.expiresAtNanos()).isBetween(before, after + TimeUnit.SECONDS.toNanos(1));
            assertThat(filter.hasBlockedSourced(viewer, UUID.randomUUID()).value()).isFalse();
            assertThat(filter.hasBlockedSourced(viewer, null).expiresAtNanos()).as("조회 없음").isEqualTo(Sourced.UNBOUNDED);
            verify(client, never()).fetchBlockedIds(viewer);

            // 세대가 올랐으면(3) 세대 0 의 캐시는 hit 가 아니다 — 정본(빈 집합)으로 판정한다.
            redis.opsForValue().set(RedisKeys.blockGeneration(viewer), "3");
            redis.opsForValue().set(RedisKeys.blockCache(viewer), "2|" + stale, Duration.ofSeconds(60));
            when(client.fetchBlockedIds(viewer)).thenReturn(Set.of());
            assertThat(filter.hasBlockedSourced(viewer, stale).value()).as("옛 세대의 캐시는 쓰지 않는다").isFalse();
            verify(client).fetchBlockedIds(viewer);
        } finally {
            redis.delete(List.of(RedisKeys.blockCache(viewer), RedisKeys.blockGeneration(viewer)));
        }
    }

    @Test
    @DisplayName("차단: 키 순서 매핑 — [캐시, 세대] 순서가 바뀌면 현재 세대의 캐시가 hit 가 되지 않는다")
    void blockKeysMapInOrder() {
        UUID viewer = UUID.randomUUID();
        UUID blocked = UUID.randomUUID();
        BlockClient client = mock(BlockClient.class);
        BlockedUsers filter = new BlockedUsers(client, redis, 120, true);
        try {
            redis.opsForValue().set(RedisKeys.blockGeneration(viewer), "3");
            redis.opsForValue().set(RedisKeys.blockCache(viewer), "3|" + blocked, Duration.ofSeconds(60));
            assertThat(filter.hasBlockedSourced(viewer, blocked).value()).isTrue();
            verify(client, never()).fetchBlockedIds(viewer); // 현재 세대(3)의 캐시라 정본을 부르지 않는다
        } finally {
            redis.delete(List.of(RedisKeys.blockCache(viewer), RedisKeys.blockGeneration(viewer)));
        }
    }

    @Test
    @DisplayName("차단: 캐시 키가 없으면 정본(BlockClient)으로 판정하고 그 적재 수명을 만료로 돌려준다")
    void blockCacheMissFallsBackToTheSourceOfTruth() {
        UUID viewer = UUID.randomUUID();
        UUID blocked = UUID.randomUUID();
        BlockClient client = mock(BlockClient.class);
        when(client.fetchBlockedIds(viewer)).thenReturn(Set.of(blocked));
        BlockedUsers filter = new BlockedUsers(client, redis, 120, true);
        try {
            long before = System.nanoTime();
            Sourced<Boolean> judged = filter.hasBlockedSourced(viewer, blocked);
            long after = System.nanoTime();
            assertThat(judged.value()).isTrue();
            verify(client).fetchBlockedIds(viewer);
            assertThat(judged.expiresAtNanos()).isBetween(before + TimeUnit.SECONDS.toNanos(119),
                    after + TimeUnit.SECONDS.toNanos(121));
            assertThat(redis.opsForValue().get(RedisKeys.blockCache(viewer))).as("적재됐다").startsWith("0|");
        } finally {
            redis.delete(List.of(RedisKeys.blockCache(viewer), RedisKeys.blockGeneration(viewer)));
        }
    }

    @Test
    @DisplayName("키가 1~2개가 아니면 거부한다")
    void readRejectsUnsupportedKeyCounts() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> Sourced.read(redis))
                .isInstanceOf(IllegalArgumentException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> Sourced.read(redis, "a", "b", "c"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

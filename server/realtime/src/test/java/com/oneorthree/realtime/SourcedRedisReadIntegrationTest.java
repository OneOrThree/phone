package com.oneorthree.realtime;

import com.oneorthree.realtime.block.BlockedUsers;
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
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

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
            assertThat(judged.value()).containsExactly(island);
            assertThat(judged.expiresAtNanos()).isBetween(before, before + TimeUnit.SECONDS.toNanos(1));

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
        UUID blocked = UUID.randomUUID();
        BlockedUsers filter = new BlockedUsers(
                org.mockito.Mockito.mock(com.oneorthree.realtime.block.client.BlockClient.class), redis, 120, true);
        try {
            redis.opsForValue().set(RedisKeys.blockCache(viewer), "0|" + blocked, Duration.ofSeconds(1));
            long before = System.nanoTime();
            Sourced<Boolean> judged = filter.hasBlockedSourced(viewer, blocked);
            assertThat(judged.value()).isTrue();
            assertThat(judged.expiresAtNanos()).isBetween(before, before + TimeUnit.SECONDS.toNanos(1));
            assertThat(filter.hasBlockedSourced(viewer, UUID.randomUUID()).value()).isFalse();
            assertThat(filter.hasBlockedSourced(viewer, null).expiresAtNanos()).as("조회 없음").isEqualTo(Sourced.UNBOUNDED);
        } finally {
            redis.delete(RedisKeys.blockCache(viewer));
        }
    }
}

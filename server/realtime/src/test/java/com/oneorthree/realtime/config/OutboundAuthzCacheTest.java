package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class OutboundAuthzCacheTest {

    private final AtomicLong now = new AtomicLong();
    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final OutboundAuthzCache cache = new OutboundAuthzCache(TimeUnit.SECONDS.toNanos(30), now::get, meters);
    private final UUID user = UUID.randomUUID();

    @Test
    @DisplayName("허용을 담으면 TTL 동안 hit, 만료되면 miss — 호출자는 동기 판정으로 돌아간다")
    void allowIsCachedUntilTtl() {
        assertThat(cache.allowed("s1", user, "/topic/groups/a")).isFalse();
        cache.allow("s1", user, "/topic/groups/a", cache.stamp());

        assertThat(cache.allowed("s1", user, "/topic/groups/a")).isTrue();
        assertThat(cache.allowed("s1", user, "/topic/groups/b")).as("범위가 다르면 따로").isFalse();
        assertThat(cache.allowed("s2", user, "/topic/groups/a")).as("세션이 다르면 따로").isFalse();
        assertThat(cache.allowed("s1", UUID.randomUUID(), "/topic/groups/a")).as("주체가 다르면 쓰지 않는다").isFalse();

        now.addAndGet(TimeUnit.SECONDS.toNanos(30));
        assertThat(cache.allowed("s1", user, "/topic/groups/a")).isFalse();
        assertThat(count("hit")).isEqualTo(1.0);
        assertThat(count("miss")).isEqualTo(5.0);
    }

    @Test
    @DisplayName("사용자·세션 무효화는 그 결정을 지운다")
    void evictionRemovesDecisions() {
        UUID other = UUID.randomUUID();
        cache.allow("s1", user, "k", cache.stamp());
        cache.allow("s2", user, "k", cache.stamp());
        cache.allow("s3", other, "k", cache.stamp());

        cache.evictUser(user);
        assertThat(cache.allowed("s1", user, "k")).isFalse();
        assertThat(cache.allowed("s2", user, "k")).isFalse();
        assertThat(cache.allowed("s3", other, "k")).isTrue();

        cache.evictSession("s3");
        assertThat(cache.allowed("s3", other, "k")).isFalse();
        assertThat(count("evict")).isEqualTo(2.0);
    }

    @Test
    @DisplayName("판정 도중 무효화가 지나가면 그 판정의 허용은 담기지 않는다 — 낡은 허용이 무효화를 덮지 못한다")
    void decisionStartedBeforeEvictionIsNotStored() {
        long stamp = cache.stamp();
        cache.evictUser(user); // 판정이 상류를 기다리는 사이 강퇴 사건이 왔다
        cache.allow("s1", user, "k", stamp);

        assertThat(cache.allowed("s1", user, "k")).isFalse();
    }

    @Test
    @DisplayName("TTL 0 은 캐시를 끈다 — 매번 동기 판정")
    void zeroTtlDisablesTheCache() {
        OutboundAuthzCache off = new OutboundAuthzCache(0, now::get, meters);
        off.allow("s1", user, "k", off.stamp());
        assertThat(off.allowed("s1", user, "k")).isFalse();
    }

    @Test
    @DisplayName("TTL 은 멤버십 캐시 TTL 을 넘지 않게 잘린다")
    void ttlIsCappedByMembershipTtl() {
        OutboundAuthzCache capped = new OutboundAuthzCache(600, 0, meters);
        capped.allow("s1", user, "k", capped.stamp());
        assertThat(capped.allowed("s1", user, "k")).as("멤버십 TTL 0 → 꺼짐").isFalse();
    }

    @Test
    @DisplayName("허용은 판정에 쓴 원본 값의 만료(notAfter)까지만 — 그사이 원본이 새 값·새 TTL 로 갈려도 옛 판정은 1s 로 남는다")
    void allowNeverOutlivesTheValueItWasJudgedOn() {
        long judgedValueExpiresAt = now.get() + TimeUnit.SECONDS.toNanos(1); // A 가 (값, 만료 1s) 를 한 번에 확보
        // … 이 사이 다른 요청이 원본을 새 값·120s 로 갈아 끼운다 — 캐시는 Redis 를 다시 읽지 않으니 영향이 없어야 한다.
        cache.allow("s1", user, "k", cache.stamp(), judgedValueExpiresAt);
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(999));
        assertThat(cache.allowed("s1", user, "k")).isTrue();
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(1));
        assertThat(cache.allowed("s1", user, "k")).isFalse();
    }

    @Test
    @DisplayName("원본 없음(EXPIRED)은 담지 않고, 제한 없음(UNBOUNDED)은 우리 TTL, 두 원본은 이른 쪽(min)")
    void notAfterSentinels() {
        cache.allow("s1", user, "gone", cache.stamp(), com.oneorthree.realtime.common.redis.Sourced.EXPIRED);
        assertThat(cache.allowed("s1", user, "gone")).isFalse();

        cache.allow("s1", user, "free", cache.stamp(), com.oneorthree.realtime.common.redis.Sourced.UNBOUNDED);
        long membership = now.get() + TimeUnit.SECONDS.toNanos(10);
        long blocks = now.get() + TimeUnit.SECONDS.toNanos(1);
        cache.allow("s1", user, "both", cache.stamp(), Math.min(membership, blocks));
        now.addAndGet(TimeUnit.SECONDS.toNanos(1));
        assertThat(cache.allowed("s1", user, "both")).as("멤버십 10s·차단 1s → 1s").isFalse();
        now.addAndGet(TimeUnit.SECONDS.toNanos(28));
        assertThat(cache.allowed("s1", user, "free")).isTrue();
        now.addAndGet(TimeUnit.SECONDS.toNanos(1));
        assertThat(cache.allowed("s1", user, "free")).as("우리 TTL 30s").isFalse();
    }

    @Test
    @DisplayName("PTTL → 절대 만료 매핑 — -2(없음) EXPIRED, -1(수명 없음) UNBOUNDED, 그 밖은 읽기 시작 + PTTL")
    void pttlMapping() {
        assertThat(com.oneorthree.realtime.common.redis.Sourced.expiresAt(100, -2))
                .isEqualTo(com.oneorthree.realtime.common.redis.Sourced.EXPIRED);
        assertThat(com.oneorthree.realtime.common.redis.Sourced.expiresAt(100, -1))
                .isEqualTo(com.oneorthree.realtime.common.redis.Sourced.UNBOUNDED);
        assertThat(com.oneorthree.realtime.common.redis.Sourced.expiresAt(100, 1500))
                .isEqualTo(100 + TimeUnit.MILLISECONDS.toNanos(1500));
    }

    @Test
    @DisplayName("만료 항목은 조회 때 지워진다")
    void expiredEntryIsRemovedOnLookup() {
        cache.allow("s1", user, "k", cache.stamp());
        now.addAndGet(TimeUnit.SECONDS.toNanos(30));
        assertThat(cache.allowed("s1", user, "k")).isFalse();
        assertThat(scopes("s1")).isZero();
    }

    @Test
    @DisplayName("범위 수가 상한을 넘으면 만료분을 걷고, 전부 살아 있으면 세션 맵을 비운다(다음 조회는 미스)")
    void scopesPerSessionAreBounded() {
        int max = OutboundAuthzCache.MAX_SCOPES_PER_SESSION;
        for (int i = 0; i < max; i++) {
            cache.allow("s1", user, "old" + i, cache.stamp());
        }
        now.addAndGet(TimeUnit.SECONDS.toNanos(30)); // 전부 만료
        cache.allow("s1", user, "fresh", cache.stamp());
        assertThat(scopes("s1")).as("만료분만 걷혔다").isEqualTo(1);
        assertThat(cache.allowed("s1", user, "fresh")).isTrue();

        for (int i = 0; i < max; i++) {
            cache.allow("s1", user, "live" + i, cache.stamp());
        }
        assertThat(scopes("s1")).as("살아 있는 채 초과 → 비운다").isZero();
        assertThat(cache.allowed("s1", user, "fresh")).isFalse();
    }

    private int scopes(String sessionId) {
        Object entries = ((java.util.Map<?, ?>) org.springframework.test.util.ReflectionTestUtils
                .getField(cache, "bySession")).get(sessionId);
        return entries == null ? 0 : ((java.util.Map<?, ?>) org.springframework.test.util.ReflectionTestUtils
                .invokeMethod(entries, "allowedUntil")).size();
    }

    @Test
    @DisplayName("섬 단위 무효화 — 그 섬 목적지(채팅·섬 채널) 범위만 모든 세션에서 지운다")
    void islandEvictionRemovesOnlyThatIslandsScopes() {
        java.util.UUID island = java.util.UUID.randomUUID();
        java.util.UUID other = java.util.UUID.randomUUID();
        cache.allow("s1", user, "/topic/groups/" + island + "#x", cache.stamp());
        cache.allow("s2", java.util.UUID.randomUUID(), "/topic/islands/" + island + "/events#y", cache.stamp());
        cache.allow("s1", user, "/topic/groups/" + other + "#x", cache.stamp());

        cache.evictIsland(island);

        assertThat(cache.allowed("s1", user, "/topic/groups/" + island + "#x")).isFalse();
        assertThat(cache.allowed("s1", user, "/topic/groups/" + other + "#x")).isTrue();
        assertThat(count("evict")).isEqualTo(1.0);
    }

    private double count(String result) {
        return meters.counter("realtime.outbound.authz.cache", "result", result).count();
    }
}

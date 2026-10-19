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
        OutboundAuthzCache capped = new OutboundAuthzCache(600, 0, meters,
                org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class),
                org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class));
        capped.allow("s1", user, "k", capped.stamp());
        assertThat(capped.allowed("s1", user, "k")).as("멤버십 TTL 0 → 꺼짐").isFalse();
    }

    private static final java.util.Set<OutboundAuthzCache.Source> MEMBERSHIP =
            java.util.EnumSet.of(OutboundAuthzCache.Source.MEMBERSHIP);
    private static final java.util.Set<OutboundAuthzCache.Source> BLOCKS =
            java.util.EnumSet.of(OutboundAuthzCache.Source.BLOCKS);
    private static final java.util.Set<OutboundAuthzCache.Source> BOTH =
            java.util.EnumSet.allOf(OutboundAuthzCache.Source.class);

    private OutboundAuthzCache withSources(long membershipSeconds, long blocksSeconds) {
        return new OutboundAuthzCache(TimeUnit.SECONDS.toNanos(30), now::get, meters, (source, userId) ->
                TimeUnit.SECONDS.toNanos(source == OutboundAuthzCache.Source.MEMBERSHIP ? membershipSeconds : blocksSeconds));
    }

    @Test
    @DisplayName("멤버십 허용은 원본 캐시(cache:chat:member) 남은 수명보다 오래 살지 않는다 — 원본 잔여 1s 면 1s 뒤 miss")
    void memberAllowNeverOutlivesTheSourceMembershipCache() {
        OutboundAuthzCache capped = withSources(1, 600);
        capped.allow("s1", user, "k", capped.stamp(), MEMBERSHIP);
        capped.allow("s1", user, "block-only", capped.stamp(), BLOCKS); // 차단만 담는 범위(응원)는 원본 멤버십과 무관
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(999));
        assertThat(capped.allowed("s1", user, "k")).isTrue();
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(1));
        assertThat(capped.allowed("s1", user, "k")).isFalse();
        assertThat(capped.allowed("s1", user, "block-only")).isTrue();

        OutboundAuthzCache gone = withSources(0, 600);
        gone.allow("s1", user, "k", gone.stamp(), MEMBERSHIP);
        assertThat(gone.allowed("s1", user, "k")).as("원본 키가 없거나 PTTL 실패면 담지 않는다").isFalse();
    }

    @Test
    @DisplayName("차단을 포함한 허용은 원본 차단 캐시(cache:chat:block) 남은 수명으로 잘린다 — 응원 1s, 멤버십 10s·차단 1s 면 1s")
    void blockAllowNeverOutlivesTheSourceBlockCache() {
        OutboundAuthzCache capped = withSources(10, 1);
        capped.allow("s1", user, "emote#x", capped.stamp(), BLOCKS);
        capped.allow("s1", user, "chat#x", capped.stamp(), BOTH);
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(999));
        assertThat(capped.allowed("s1", user, "emote#x")).isTrue();
        assertThat(capped.allowed("s1", user, "chat#x")).isTrue();
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(1));
        assertThat(capped.allowed("s1", user, "emote#x")).isFalse();
        assertThat(capped.allowed("s1", user, "chat#x")).as("두 원본 중 짧은 쪽").isFalse();

        OutboundAuthzCache noBlockSource = withSources(10, 0);
        noBlockSource.allow("s1", user, "emote#x", noBlockSource.stamp(), BLOCKS);
        noBlockSource.allow("s1", user, "chat#x", noBlockSource.stamp(), BOTH);
        assertThat(noBlockSource.allowed("s1", user, "emote#x")).as("차단 원본 없음 → 담지 않는다").isFalse();
        assertThat(noBlockSource.allowed("s1", user, "chat#x")).isFalse();
    }

    @Test
    @DisplayName("원본 남은 수명 읽기 — 실제 키(멤버십·차단)의 PTTL, -2(없음)·실패는 0, -1 은 제한 없음, ON 은 멤버십 PTTL 을 묻지 않는다")
    void sourceRemainingLifetimeMapping() {
        assertThat(OutboundAuthzCache.remainingNanos(-2L)).isZero();
        assertThat(OutboundAuthzCache.remainingNanos(null)).isZero();
        assertThat(OutboundAuthzCache.remainingNanos(-1L)).isEqualTo(Long.MAX_VALUE);
        assertThat(OutboundAuthzCache.remainingNanos(1500L)).isEqualTo(TimeUnit.MILLISECONDS.toNanos(1500));

        org.springframework.data.redis.core.StringRedisTemplate redis =
                org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        String memberKey = com.oneorthree.realtime.common.redis.RedisKeys.memberCache(user);
        String blockKey = com.oneorthree.realtime.common.redis.RedisKeys.blockCache(user);
        org.mockito.Mockito.when(redis.getExpire(memberKey, TimeUnit.MILLISECONDS)).thenReturn(10_000L);
        org.mockito.Mockito.when(redis.getExpire(blockKey, TimeUnit.MILLISECONDS)).thenReturn(1_000L);
        @SuppressWarnings("unchecked")
        org.springframework.beans.factory.ObjectProvider<com.oneorthree.realtime.membership.CurrentMembershipVerifier>
                off = org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        OutboundAuthzCache offMode = new OutboundAuthzCache(30, 120, meters, redis, off);
        offMode.allow("s1", user, "chat#x", offMode.stamp(), BOTH);
        org.mockito.Mockito.verify(redis).getExpire(memberKey, TimeUnit.MILLISECONDS);
        org.mockito.Mockito.verify(redis).getExpire(blockKey, TimeUnit.MILLISECONDS);
        assertThat(offMode.allowed("s1", user, "chat#x")).isTrue();

        org.springframework.data.redis.core.StringRedisTemplate broken =
                org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        org.mockito.Mockito.when(broken.getExpire(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(TimeUnit.MILLISECONDS))).thenThrow(new IllegalStateException("redis"));
        assertThat(OutboundAuthzCache.remainingNanos(broken, blockKey)).isZero();

        @SuppressWarnings("unchecked")
        org.springframework.beans.factory.ObjectProvider<com.oneorthree.realtime.membership.CurrentMembershipVerifier>
                on = org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(on.getIfAvailable())
                .thenReturn(org.mockito.Mockito.mock(com.oneorthree.realtime.membership.CurrentMembershipVerifier.class));
        OutboundAuthzCache onMode = new OutboundAuthzCache(30, 120, meters, broken, on);
        onMode.allow("s1", user, "k", onMode.stamp(), MEMBERSHIP);
        assertThat(onMode.allowed("s1", user, "k")).as("ON 은 멤버십 원본이 없다 — PTTL 실패와 무관하게 담는다").isTrue();
        onMode.allow("s1", user, "emote#x", onMode.stamp(), BLOCKS);
        assertThat(onMode.allowed("s1", user, "emote#x")).as("ON 이어도 차단 원본은 본다 — PTTL 실패면 담지 않는다").isFalse();
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

    private double count(String result) {
        return meters.counter("realtime.outbound.authz.cache", "result", result).count();
    }
}

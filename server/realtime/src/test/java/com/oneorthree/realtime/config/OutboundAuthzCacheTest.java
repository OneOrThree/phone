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

    @Test
    @DisplayName("멤버십 허용은 원본 캐시(cache:chat:member) 남은 수명보다 오래 살지 않는다 — 원본 잔여 1s 면 1s 뒤 miss")
    void memberAllowNeverOutlivesTheSourceMembershipCache() {
        OutboundAuthzCache capped = new OutboundAuthzCache(TimeUnit.SECONDS.toNanos(30), now::get, meters,
                userId -> TimeUnit.SECONDS.toNanos(1));
        capped.allowMember("s1", user, "k", capped.stamp());
        capped.allow("s1", user, "block-only", capped.stamp()); // 차단만 담는 범위(응원)는 원본 멤버십과 무관
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(999));
        assertThat(capped.allowed("s1", user, "k")).isTrue();
        now.addAndGet(TimeUnit.MILLISECONDS.toNanos(1));
        assertThat(capped.allowed("s1", user, "k")).isFalse();
        assertThat(capped.allowed("s1", user, "block-only")).isTrue();

        OutboundAuthzCache gone = new OutboundAuthzCache(TimeUnit.SECONDS.toNanos(30), now::get, meters,
                userId -> 0L);
        gone.allowMember("s1", user, "k", gone.stamp());
        assertThat(gone.allowed("s1", user, "k")).as("원본 키가 없거나 PTTL 실패면 담지 않는다").isFalse();
    }

    @Test
    @DisplayName("원본 남은 수명 읽기 — PTTL -2(없음)·실패는 0, -1(수명 없음)은 제한 없음, ON(verifier)은 PTTL 을 묻지 않는다")
    void sourceRemainingLifetimeMapping() {
        assertThat(OutboundAuthzCache.remainingNanos(-2L)).isZero();
        assertThat(OutboundAuthzCache.remainingNanos(null)).isZero();
        assertThat(OutboundAuthzCache.remainingNanos(-1L)).isEqualTo(Long.MAX_VALUE);
        assertThat(OutboundAuthzCache.remainingNanos(1500L)).isEqualTo(TimeUnit.MILLISECONDS.toNanos(1500));

        org.springframework.data.redis.core.StringRedisTemplate redis =
                org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        org.mockito.Mockito.when(redis.getExpire(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(TimeUnit.MILLISECONDS))).thenThrow(new IllegalStateException("redis"));
        assertThat(OutboundAuthzCache.memberCacheRemainingNanos(redis, user)).isZero();

        @SuppressWarnings("unchecked")
        org.springframework.beans.factory.ObjectProvider<com.oneorthree.realtime.membership.CurrentMembershipVerifier>
                on = org.mockito.Mockito.mock(org.springframework.beans.factory.ObjectProvider.class);
        org.mockito.Mockito.when(on.getIfAvailable())
                .thenReturn(org.mockito.Mockito.mock(com.oneorthree.realtime.membership.CurrentMembershipVerifier.class));
        OutboundAuthzCache onMode = new OutboundAuthzCache(30, 120, meters, redis, on);
        onMode.allowMember("s1", user, "k", onMode.stamp());
        assertThat(onMode.allowed("s1", user, "k")).isTrue();
        org.mockito.Mockito.verify(redis, org.mockito.Mockito.times(1))
                .getExpire(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any());
    }

    private double count(String result) {
        return meters.counter("realtime.outbound.authz.cache", "result", result).count();
    }
}

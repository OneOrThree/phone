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

    private double count(String result) {
        return meters.counter("realtime.outbound.authz.cache", "result", result).count();
    }
}

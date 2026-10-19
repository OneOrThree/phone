package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.auth.VerifiedAccessIdentity;
import com.oneorthree.realtime.config.RealtimeAuthorizationProperties;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * ON 모드(현재 멤버십 HTTP 판정)의 «허용» 결정 캐시 — 인스턴스 로컬, 인메모리.
 *
 * <p>키는 (userId, sessionId, authGeneration, islandId) — 세션이 바뀌거나 세대가 오르면 옛 항목에 닿지 않는다.
 * <b>거절·오류는 캐시하지 않는다</b>(허용으로 뒤집힐 때 지연 없이 풀리고, 거절이 오래 남지 않는다).
 * 무효화: 멤버십 변경 사건(가입·탈퇴·강퇴)·{@code user.withdrawn} 이 {@link #evictUser} 를 부른다. TTL 은 백스톱이다.
 *
 * <p>사건은 Kafka 소비 그룹·HTTP 로 «한 인스턴스»에만 닿으므로 다른 인스턴스의 항목은 TTL 로만 닫힌다.
 * 여러 인스턴스 + 즉시성이 필요하면 {@code cache-ttl-seconds=0} 으로 끈다.
 *
 * <p>evict 와 진행 중 조회가 겹쳐 «옛 허용»이 evict 뒤에 들어가는 것을 {@link #mark}/{@link #remember} 가 막는다.
 */
public class CurrentMembershipDecisionCache {
    /** ponytail: 상한에 닿으면 새 항목을 안 넣는다(만료 정리 후). evictUser 는 O(n) — 사건이 드물어 허용. */
    private static final int MAX_ENTRIES = 50_000;

    private record Key(UUID userId, UUID sessionId, long generation, UUID islandId) { }

    private final ConcurrentHashMap<Key, Long> entries = new ConcurrentHashMap<>();
    private final AtomicLong evictions = new AtomicLong();
    private final long ttlNanos;
    private final Counter hit;
    private final Counter miss;
    private final Counter evict;

    public CurrentMembershipDecisionCache(RealtimeAuthorizationProperties properties, MeterRegistry registry) {
        this.ttlNanos = properties.getCacheTtlSeconds() * 1_000_000_000L;
        hit = Counter.builder("realtime.authz.cache").tag("result", "hit").register(registry);
        miss = Counter.builder("realtime.authz.cache").tag("result", "miss").register(registry);
        evict = Counter.builder("realtime.authz.cache").tag("result", "evict").register(registry);
    }

    public boolean enabled() {
        return ttlNanos > 0;
    }

    public boolean isAllowed(VerifiedAccessIdentity id, UUID islandId) {
        if (!enabled()) {
            return false;
        }
        Key key = new Key(id.userId(), id.sessionId(), id.authGeneration(), islandId);
        Long expiry = entries.get(key);
        if (expiry != null && expiry - System.nanoTime() > 0) {
            hit.increment();
            return true;
        }
        if (expiry != null) {
            entries.remove(key, expiry);
        }
        miss.increment();
        return false;
    }

    /** 원격 조회 «전에» 부른다. */
    public long mark() {
        return evictions.get();
    }

    /** 허용 답만 넣는다. mark 이후 evict 가 있었으면 넣지 않는다. */
    public void remember(VerifiedAccessIdentity id, UUID islandId, long mark) {
        if (!enabled() || evictions.get() != mark) {
            return;
        }
        if (entries.size() >= MAX_ENTRIES) {
            long now = System.nanoTime();
            entries.values().removeIf(expiry -> expiry - now <= 0);
            if (entries.size() >= MAX_ENTRIES) {
                return;
            }
        }
        entries.put(new Key(id.userId(), id.sessionId(), id.authGeneration(), islandId),
                System.nanoTime() + ttlNanos);
        if (evictions.get() != mark) { // put 직전 evict 가 끼어든 경우
            entries.remove(new Key(id.userId(), id.sessionId(), id.authGeneration(), islandId));
        }
    }

    public void evictUser(UUID userId) {
        evictions.incrementAndGet();
        int before = entries.size();
        entries.keySet().removeIf(key -> key.userId().equals(userId));
        evict.increment(Math.max(1, before - entries.size()));
    }
}

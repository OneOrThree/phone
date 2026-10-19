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
 * 무효화: 멤버십 변경 사건(가입·탈퇴·강퇴)·{@code user.withdrawn} 이 {@link #evictUser} 를, 사용자를 모르는
 * 멤버십 사건(옛 Data)은 {@link #evictIsland} 를 부른다. TTL 은 백스톱이다.
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

    /** 허용 항목 — 만료 시각과 «넣을 때의 사용자 세대». 조회 때 세대가 다르면 무효(게시·무효화 경합을 세대로 막는다). */
    private record Entry(long expiresAt, long userGeneration, long islandGeneration) { }

    /** 원격 조회 전에 뜬 두 축(사용자·섬)의 무효화 세대. */
    public record Mark(long user, long island) { }

    private final ConcurrentHashMap<Key, Entry> entries = new ConcurrentHashMap<>();

    /** 사용자별 무효화 세대 — evictUser 마다 1 증가. 항목은 넣을 때의 세대를 품고, 조회는 현재 세대와 같을 때만 믿는다. */
    private record Generation(long value, long touchedAt) { }

    /**
     * 세대 기록은 «그 사용자의 허용 항목이 살아 있거나 원격 조회가 진행 중일 수 있는 동안»만 필요하다.
     * 상한을 넘으면 TTL + 유예(원격 조회 최대 시간보다 길게)가 지난 기록을 지운다 — 그보다 오래된 mark 를 든
     * 진행 중 조회는 없고, 그 세대로 넣은 항목은 이미 만료다(정리 뒤 남은 항목이 있어도 세대 불일치 → 미스로 끝난다).
     */
    private static final int MAX_GENERATIONS = 50_000;
    /** ⚠️ 원격 조회 최대 시간(request-timeout 상한 10s, {@code RealtimeAuthorizationProperties})보다 커야 한다. */
    private static final long GENERATION_GRACE_NANOS = 10_000_000_000L;
    private final ConcurrentHashMap<UUID, Generation> userGenerations = new ConcurrentHashMap<>();
    /** 섬별 무효화 세대 — 같은 상한·정리 규칙. */
    private final ConcurrentHashMap<UUID, Generation> islandGenerations = new ConcurrentHashMap<>();
    /**
     * 세대 값은 전역 단조 카운터에서 발급한다 — 정리로 기록이 사라진 사용자가 다시 evict 되어도 «이전과 같은 번호»가
     * 나오지 않으므로, 옛 mark 를 든 진행 중 조회의 remember 가 통과할 수 없다(codex 게이트: 정리 뒤 번호 재사용 경합).
     */
    private final AtomicLong generationCounter = new AtomicLong();
    private final long ttlNanos;
    private final Counter hit;
    private final Counter miss;
    private final Counter evict;

    public CurrentMembershipDecisionCache(RealtimeAuthorizationProperties properties, MeterRegistry registry) {
        // 인가 클라이언트 OFF 면 verifier 가 없어 쓸 곳이 없다 — 꺼 두어 사건이 세대 맵을 키우지 않게 한다.
        this.ttlNanos = properties.isEnabled() ? properties.getCacheTtlSeconds() * 1_000_000_000L : 0L;
        hit = Counter.builder("realtime.authorization.cache").tag("result", "hit").register(registry);
        miss = Counter.builder("realtime.authorization.cache").tag("result", "miss").register(registry);
        evict = Counter.builder("realtime.authorization.cache").tag("result", "evict").register(registry);
    }

    public boolean enabled() {
        return ttlNanos > 0;
    }

    public boolean isAllowed(VerifiedAccessIdentity id, UUID islandId) {
        if (!enabled()) {
            return false;
        }
        Key key = new Key(id.userId(), id.sessionId(), id.authGeneration(), islandId);
        Entry entry = entries.get(key);
        if (entry != null && entry.expiresAt() - System.nanoTime() > 0
                && entry.userGeneration() == generation(userGenerations, id.userId())
                && entry.islandGeneration() == generation(islandGenerations, islandId)) {
            hit.increment();
            return true;
        }
        if (entry != null) {
            entries.remove(key, entry); // 만료 또는 무효화 세대 — 사후 정리
        }
        miss.increment();
        return false;
    }

    /** 원격 조회 «전에» 부른다 — 그 사용자·섬의 현재 무효화 세대. */
    public Mark mark(UUID userId, UUID islandId) {
        return new Mark(generation(userGenerations, userId), generation(islandGenerations, islandId));
    }

    private static long generation(ConcurrentHashMap<UUID, Generation> map, UUID id) {
        Generation generation = map.get(id);
        return generation == null ? 0L : generation.value();
    }

    /**
     * 허용 답만 넣는다. 항목은 mark(세대)를 품으므로, 세대 검사와 put 사이에 evict 가 끼어도
     * 조회가 세대 불일치로 거절한다 — 사후 삭제 전에도 옛 허용이 노출되지 않는다.
     */
    public void remember(VerifiedAccessIdentity id, UUID islandId, Mark mark) {
        if (!enabled() || !mark(id.userId(), islandId).equals(mark)) {
            return;
        }
        if (entries.size() >= MAX_ENTRIES) {
            long now = System.nanoTime();
            entries.values().removeIf(entry -> entry.expiresAt() - now <= 0);
            if (entries.size() >= MAX_ENTRIES) {
                return;
            }
        }
        entries.put(new Key(id.userId(), id.sessionId(), id.authGeneration(), islandId),
                new Entry(System.nanoTime() + ttlNanos, mark.user(), mark.island()));
    }

    public void evictUser(UUID userId) {
        evict(userGenerations, userId, key -> key.userId().equals(userId));
    }

    /** 사용자를 모르는 섬 멤버십 사건 — 그 섬의 모든 허용 항목을 지운다. */
    public void evictIsland(UUID islandId) {
        evict(islandGenerations, islandId, key -> key.islandId().equals(islandId));
    }

    private void evict(ConcurrentHashMap<UUID, Generation> generations, UUID id,
            java.util.function.Predicate<Key> matches) {
        if (!enabled()) {
            return; // 캐시가 꺼져 있으면 기록할 것이 없다 — 세대 맵도 키우지 않는다
        }
        long now = System.nanoTime();
        // 먼저 세대를 올려 진행 중 조회·게시를 무효화한다
        generations.put(id, new Generation(generationCounter.incrementAndGet(), now));
        int before = entries.size();
        entries.keySet().removeIf(matches);
        evict.increment(Math.max(1, before - entries.size()));
        if (generations.size() > MAX_GENERATIONS) {
            pruneStaleGenerations(now);
        }
    }

    /** TTL + 유예가 지난 세대 기록을 지운다(상한 초과 때). 테스트에서 시각을 주입하려고 패키지 공개. */
    void pruneStaleGenerations(long nowNanos) {
        long horizon = ttlNanos + GENERATION_GRACE_NANOS;
        userGenerations.values().removeIf(generation -> nowNanos - generation.touchedAt() > horizon);
        islandGenerations.values().removeIf(generation -> nowNanos - generation.touchedAt() > horizon);
    }

    int generationCount() {
        return userGenerations.size() + islandGenerations.size();
    }
}

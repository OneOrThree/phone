package com.oneorthree.realtime.config;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;
import java.util.function.ToLongFunction;

/**
 * 전달 직전 인가의 «허용» 결정 캐시 (GROMO-2340) — 키는 (세션, 판정 범위), 값은 만료 시각.
 *
 * <p>{@link ChatOutboundChannelInterceptor} 는 아웃바운드 실행기 스레드에서 프레임 × 수신 세션마다 판정한다. 채팅
 * 한 건이 멤버십(Redis, 미스 시 HTTP)·차단 집합(Redis MGET)을 구독자 수만큼 치르면, 그 I/O 가
 * 공용 실행기를 붙잡아 뒤에 줄 선 이동 프레임까지 늦춘다(조사: 채팅 50명×10Hz 에서 대기 13,724작업, 이동 p95 633ms).
 * 그래서 한 번 통과한 (세션, 범위)는 짧은 시간 다시 묻지 않는다. 범위는 호출자가 정한다 — 차단이 발신자마다 다르므로
 * 채팅·섬 소식은 {@code 목적지#발신자}, 응원은 차단 판정만 같은 꼴로 담는다.
 *
 * <p><b>집중 여부는 담지 않는다.</b> 집중 시작은 무효화 사건이 없고 「집중 중 채팅 차단」은 즉시여야 하므로 호출자가 hit 에서도
 * 프레즌스를 다시 본다({@code ChatOutboundChannelInterceptor}).
 *
 * <h2>허용만 담는다 — fail-closed</h2>
 * 캐시가 없거나 만료면 호출자는 종전 동기 판정을 그대로 탄다. 거절·판정 불가(상류 장애)·자격 거절은 담지 않는다 — 다음
 * 프레임이 다시 묻는다. 담긴 «허용»이 낡을 수 있는 창은 아래 무효화가 닫고, 놓친 것은 TTL 이 상한이다.
 *
 * <h2>무효화 지점</h2>
 * <ul>
 *   <li>{@code island.members.updated}(MEMBER_ADDED·MEMBER_REMOVED)·{@code user.blocks.updated}(차단자)·
 *       {@code user.withdrawn} — {@code InboundEventService} 가 원 캐시(Redis 멤버십·차단 세대)를 고친 <b>뒤에</b>
 *       {@link #evictUser} 를 부른다. 앞에서 지우면 그 사이의 미스가 옛 Redis 값으로 다시 담는다.</li>
 *   <li>소켓 종료 — {@code WebSocketConfig} 의 종료 경로가 {@link #evictSession}.</li>
 * </ul>
 * 무효화와 동시에 진행 중이던 판정이 낡은 허용을 뒤늦게 담지 않도록 세대({@link #stamp})를 쓴다 — 판정 «전에» 읽은
 * 세대가 담는 순간 바뀌었으면 담은 것을 지운다.
 *
 * <h2>남는 창 — TTL({@code chat.websocket.outbound.authz-cache-ttl-seconds}, 기본 30s)이 상한</h2>
 * <ul>
 *   <li>사건을 처리한 인스턴스만 지운다(이 캐시는 JVM 안이다) — 다른 인스턴스는 TTL 뒤에 반영된다.</li>
 *   <li>세션 폐기(ON 모드 sid/gen)도 사건이 없다 — TTL 뒤 다음 미스에서 자격 거절로 닫힌다.</li>
 * </ul>
 * TTL 은 멤버십 캐시 TTL({@code chat.membership.cache-ttl-seconds})을 넘지 않게 자른다. 0 이면 캐시를 끈다(종전 동작).
 *
 * <h2>멤버십 허용은 원본 캐시보다 오래 살지 않는다</h2>
 * 인가 옵션 OFF 의 멤버십 판정은 Redis {@code cache:chat:member:{userId}} 로 통과한다. 원본의 남은 수명이 1초인 판정을
 * 담으면서 새로 30초를 주면, 사건 유실·Redis 삭제 실패 때 원본이 만료된 뒤에도 29초 동안 강퇴자가 받는다 — 「강퇴 반영
 * 상한 = 멤버십 TTL」이 깨진다. 그래서 멤버십을 담을 때({@link #allowMember})는 원본 키의 남은 수명(PTTL 1회, 담는 «미스»
 * 경로에서만 — hit 경로엔 I/O 가 없다)으로 만료를 자른다. 키가 없거나 PTTL 이 실패하면 담지 않는다(fail-closed). 옵션 ON
 * (현재 인가 verifier)은 원본 캐시가 없어 우리 TTL 그대로다.
 * 바다 방의 프레임마다 Redis 재검사(GROMO-2302 「전달 직전 재검사」)는 여기 담지 않는다.
 */
@Component
public class OutboundAuthzCache {

    private final long ttlNanos;
    private final LongSupplier nanoTime;
    private final Map<String, SessionEntries> bySession = new ConcurrentHashMap<>();
    private final AtomicLong epoch = new AtomicLong();
    private final Counter hit;
    private final Counter miss;
    private final Counter evict;
    /** 그 사용자의 원본 멤버십 캐시 남은 수명(ns). {@link Long#MAX_VALUE} = 제한 없음, 0 이하 = 담지 않는다. */
    private final ToLongFunction<UUID> memberSourceRemainingNanos;

    @Autowired
    public OutboundAuthzCache(@Value("${chat.websocket.outbound.authz-cache-ttl-seconds:30}") long ttlSeconds,
            @Value("${chat.membership.cache-ttl-seconds:120}") long membershipTtlSeconds, MeterRegistry meterRegistry,
            StringRedisTemplate redis, ObjectProvider<CurrentMembershipVerifier> currentVerifier) {
        this(TimeUnit.SECONDS.toNanos(Math.max(0, Math.min(ttlSeconds, membershipTtlSeconds))), System::nanoTime,
                meterRegistry, userId -> currentVerifier.getIfAvailable() != null ? Long.MAX_VALUE
                        : memberCacheRemainingNanos(redis, userId));
    }

    OutboundAuthzCache(long ttlNanos, LongSupplier nanoTime, MeterRegistry meterRegistry) {
        this(ttlNanos, nanoTime, meterRegistry, userId -> Long.MAX_VALUE);
    }

    OutboundAuthzCache(long ttlNanos, LongSupplier nanoTime, MeterRegistry meterRegistry,
            ToLongFunction<UUID> memberSourceRemainingNanos) {
        this.memberSourceRemainingNanos = memberSourceRemainingNanos;
        this.ttlNanos = ttlNanos;
        this.nanoTime = nanoTime;
        this.hit = counter(meterRegistry, "hit");
        this.miss = counter(meterRegistry, "miss");
        this.evict = counter(meterRegistry, "evict");
    }

    /** 꺼진 캐시 — 직접 생성하는 옛 호출부가 종전(프레임마다 판정) 의미를 유지한다. */
    static OutboundAuthzCache disabled() {
        return new OutboundAuthzCache(0, System::nanoTime, new SimpleMeterRegistry());
    }

    /** 원본 멤버십 캐시 키의 남은 수명 — 키 없음(-2)·PTTL 실패는 0(담지 않음), 수명 없음(-1)은 제한 없음. */
    static long memberCacheRemainingNanos(StringRedisTemplate redis, UUID userId) {
        try {
            return remainingNanos(redis.getExpire(RedisKeys.memberCache(userId), TimeUnit.MILLISECONDS));
        } catch (RuntimeException e) {
            return 0;
        }
    }

    static long remainingNanos(Long pttlMillis) {
        if (pttlMillis == null || pttlMillis == -2) {
            return 0;
        }
        return pttlMillis < 0 ? Long.MAX_VALUE : TimeUnit.MILLISECONDS.toNanos(pttlMillis);
    }

    private static Counter counter(MeterRegistry registry, String result) {
        return Counter.builder("realtime.outbound.authz.cache").tag("result", result)
                .description("전달 직전 인가 결정 캐시").register(registry);
    }

    /** 판정 «전에» 읽는 세대 — {@link #allow} 에 그대로 넘긴다. */
    long stamp() {
        return epoch.get();
    }

    /** 이 세션·주체가 이 범위를 TTL 안에 허용받았는가. 아니면 호출자는 동기 판정을 탄다. */
    boolean allowed(String sessionId, UUID userId, String scope) {
        if (ttlNanos == 0 || sessionId == null) {
            return false;
        }
        SessionEntries entries = bySession.get(sessionId);
        Long until = entries == null || !entries.userId().equals(userId) ? null : entries.allowedUntil().get(scope);
        if (until != null && until - nanoTime.getAsLong() > 0) {
            hit.increment();
            return true;
        }
        miss.increment();
        return false;
    }

    /** 동기 판정이 통과했다 — {@code stamp} 이후 무효화가 있었으면 담지 않는다(담았다가 지운다). */
    void allow(String sessionId, UUID userId, String scope, long stamp) {
        store(sessionId, userId, scope, stamp, ttlNanos);
    }

    /** 멤버십을 포함한 판정이 통과했다 — 만료를 원본 멤버십 캐시의 남은 수명으로 자른다. */
    void allowMember(String sessionId, UUID userId, String scope, long stamp) {
        if (ttlNanos == 0 || sessionId == null) {
            return;
        }
        store(sessionId, userId, scope, stamp, Math.min(ttlNanos, memberSourceRemainingNanos.applyAsLong(userId)));
    }

    private void store(String sessionId, UUID userId, String scope, long stamp, long lifetimeNanos) {
        if (ttlNanos == 0 || sessionId == null || lifetimeNanos <= 0) {
            return;
        }
        SessionEntries entries = bySession.computeIfAbsent(sessionId,
                id -> new SessionEntries(userId, new ConcurrentHashMap<>()));
        if (!entries.userId().equals(userId)) {
            return;
        }
        entries.allowedUntil().put(scope, nanoTime.getAsLong() + lifetimeNanos);
        // 무효화는 세대를 먼저 올리고 지운다 — 여기서 세대가 다르면 그 무효화가 이 값을 못 봤을 수 있다.
        if (epoch.get() != stamp) {
            bySession.remove(sessionId);
        }
    }

    /** 그 사용자의 모든 세션 결정을 지운다 — 멤버십·차단·탈퇴 사건. */
    public void evictUser(UUID userId) {
        epoch.incrementAndGet();
        if (bySession.values().removeIf(entries -> entries.userId().equals(userId))) {
            evict.increment();
        }
    }

    /** 소켓 종료 — 그 세션의 결정을 지운다. */
    public void evictSession(String sessionId) {
        epoch.incrementAndGet();
        if (sessionId != null && bySession.remove(sessionId) != null) {
            evict.increment();
        }
    }

    private record SessionEntries(UUID userId, Map<String, Long> allowedUntil) {
    }
}

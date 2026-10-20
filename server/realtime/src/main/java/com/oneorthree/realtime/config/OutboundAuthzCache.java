package com.oneorthree.realtime.config;

import com.oneorthree.realtime.common.redis.Sourced;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

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
 *   <li>세션 폐기({@code auth.session.revoked}, GROMO-2350)는 사건이 그 sid 의 STOMP 연결을 닫고 {@link #evictSession} 으로
 *       지운다. 단 Data 의 생산 스위치(기본 OFF)가 꺼져 있거나 사건이 다른 인스턴스에 닿았으면 사건이 없다 — ON 모드는 sid/gen 거절로,
 *       OFF 모드는 AT 만료로 닫힌다.</li>
 * </ul>
 * TTL 은 멤버십 캐시 TTL({@code chat.membership.cache-ttl-seconds})을 넘지 않게 자른다. 0 이면 캐시를 끈다(종전 동작).
 *
 * <h2>허용은 그 판정의 원본 캐시보다 오래 살지 않는다</h2>
 * 판정이 Redis 캐시로 통과했다면 그 원본의 남은 수명이 1초일 수 있다. 거기에 새로 30초를 주면 사건 유실·relay OFF·Redis 삭제
 * 실패 때 원본이 만료돼 다시 물었어야 할 시점 뒤로 최대 29초 동안 강퇴자·차단한 발신자의 프레임이 나간다 — 「강퇴 반영 상한 =
 * 멤버십 TTL」「차단 TTL 백스톱」이 깨진다. 그래서 호출자가 판정에 쓴 원본 값과 <b>그 값의</b> 만료를 한 원자 단위로 읽어
 * ({@link Sourced}, Lua GET+PTTL) 절대 시각 {@code notAfterNanos} 로 넘기고, 여기서는 {@code min(지금 + 우리 TTL, notAfter)}
 * 까지만 담는다. 값과 PTTL 을 따로 읽으면 그 사이 다른 요청이 키를 새 값·새 TTL 로 갈아 끼워 옛 판정이 새 수명을 얻는다
 * (사건이 없으니 {@link #stamp} 도 못 막는다). 원본이 없거나 읽기가 실패하면 {@link Sourced#EXPIRED} — 담지 않는다. 이 클래스는
 * Redis 를 읽지 않는다.
 * <table>
 *   <caption>판정 → 원본</caption>
 *   <tr><th>판정</th><th>원본 키</th><th>쓰는 범위</th></tr>
 *   <tr><td>멤버십</td><td>{@code cache:chat:member:{userId}} (옵션 ON 은 원본 없음 → 우리 TTL)</td>
 *       <td>채팅·{@code events}</td></tr>
 *   <tr><td>차단</td><td>{@code cache:chat:block:{userId}} (받는 사람 기준 집합, {@code BlockedUsers})</td>
 *       <td>필터 ON 에서 실제로 조회한 채팅·{@code events}·응원</td></tr>
 * </table>
 * 차단의 세대 키({@code cache:chat:blockgen:*})는 수명이 없고 무효화 신호일 뿐이다 — 집합의 수명은 위 캐시 키가 정한다.
 * 바다 방의 프레임마다 Redis 재검사(GROMO-2302 「전달 직전 재검사」)는 여기 담지 않는다.
 */
@Component
public class OutboundAuthzCache {

    /**
     * 세션 하나가 들 수 있는 범위(목적지·발신자 조합) 수. 만료 항목은 조회 때 지우고, 이 수를 넘으면 담는 순간 만료분을 걷고,
     * 그래도 넘으면 그 세션 맵을 비운다(다음 프레임은 미스 → 동기 판정, fail-safe). 256 은 구독 상한 96 × 섬 채팅의 활발한
     * 발신자 몇 명을 덮는 값이다. 세션 수 자체엔 상한을 두지 않는다 — 소켓 종료가 {@link #evictSession} 으로 회수한다.
     * 구독 해지(UNSUBSCRIBE) 때는 지우지 않는다 — 해지된 목적지엔 프레임이 오지 않아 항목이 만료된 채 남고, 위 두 정리가 걷는다.
     */
    static final int MAX_SCOPES_PER_SESSION = 256;

    private final long ttlNanos;
    private final LongSupplier nanoTime;
    private final Map<String, SessionEntries> bySession = new ConcurrentHashMap<>();
    private final AtomicLong epoch = new AtomicLong();
    private final Counter hit;
    private final Counter miss;
    private final Counter evict;


    @Autowired
    public OutboundAuthzCache(@Value("${chat.websocket.outbound.authz-cache-ttl-seconds:30}") long ttlSeconds,
            @Value("${chat.membership.cache-ttl-seconds:120}") long membershipTtlSeconds, MeterRegistry meterRegistry) {
        this(TimeUnit.SECONDS.toNanos(Math.max(0, Math.min(ttlSeconds, membershipTtlSeconds))), System::nanoTime,
                meterRegistry);
    }

    OutboundAuthzCache(long ttlNanos, LongSupplier nanoTime, MeterRegistry meterRegistry) {
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
        if (until != null) {
            entries.allowedUntil().remove(scope, until); // 만료 — 그사이 새로 담긴 값은 건드리지 않는다
        }
        miss.increment();
        return false;
    }

    /** 캐시가 켜져 있는가 — 꺼져 있으면 호출자는 원본 만료를 읽는 수고도 하지 않는다. */
    boolean enabled() {
        return ttlNanos > 0;
    }

    /** 원본 캐시 없이 통과한 판정 — 우리 TTL 그대로. */
    void allow(String sessionId, UUID userId, String scope, long stamp) {
        allow(sessionId, userId, scope, stamp, Sourced.UNBOUNDED);
    }

    /**
     * 동기 판정이 통과했다 — {@code stamp} 이후 무효화가 있었으면 담지 않는다(담았다가 지운다).
     *
     * @param notAfterNanos 판정에 쓴 원본 값의 만료({@link Sourced#expiresAtNanos}, 여럿이면 가장 이른 것) — 이 뒤로는 담지 않는다
     */
    void allow(String sessionId, UUID userId, String scope, long stamp, long notAfterNanos) {
        if (ttlNanos == 0 || sessionId == null || notAfterNanos == Sourced.EXPIRED) {
            return;
        }
        long now = nanoTime.getAsLong();
        // 절대 만료를 «한 번» 계산해 그대로 담는다 — 남은 수명을 계산한 뒤 시간을 다시 읽어 더하면 그 사이 지연(GC·대기)만큼
        // 원본보다 오래 살아 강퇴·차단 반영 상한을 넘긴다.
        long until = notAfterNanos == Sourced.UNBOUNDED ? now + ttlNanos : Math.min(now + ttlNanos, notAfterNanos);
        store(sessionId, userId, scope, stamp, now, until);
    }

    private void store(String sessionId, UUID userId, String scope, long stamp, long now, long untilNanos) {
        if (ttlNanos == 0 || sessionId == null || untilNanos - now <= 0) {
            return;
        }
        SessionEntries entries = bySession.computeIfAbsent(sessionId,
                id -> new SessionEntries(userId, new ConcurrentHashMap<>()));
        if (!entries.userId().equals(userId)) {
            return;
        }
        Map<String, Long> allowedUntil = entries.allowedUntil();
        allowedUntil.put(scope, untilNanos);
        if (allowedUntil.size() > MAX_SCOPES_PER_SESSION) {
            allowedUntil.values().removeIf(until -> until - now <= 0);
            if (allowedUntil.size() > MAX_SCOPES_PER_SESSION) {
                allowedUntil.clear();
            }
        }
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

    /**
     * 사용자를 모르는 멤버십 사건(옛 Data — {@code memberUserId} 없음·형식 불량) — 그 섬 목적지의 결정을 모든 세션에서 지운다.
     * 범위 키는 목적지로 시작하므로({@code /topic/groups/{id}}·{@code /topic/islands/{id}/…}) 접두사로 고른다.
     * ponytail: 세션 × 범위를 훑는다 — 옛 Data 사건에서만 불려 드물다.
     */
    public void evictIsland(UUID islandId) {
        epoch.incrementAndGet();
        String chat = "/topic/groups/" + islandId;
        String island = "/topic/islands/" + islandId + "/";
        boolean removed = false;
        for (SessionEntries entries : bySession.values()) {
            removed |= entries.allowedUntil().keySet().removeIf(scope -> scope.equals(chat)
                    || scope.startsWith(chat + "#") || scope.startsWith(island));
        }
        if (removed) {
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

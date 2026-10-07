package com.oneorthree.business.auth;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 로그아웃·탈퇴로 폐기된 세션 id(sid)의 거부목록. AT 서명·만료만 보는 필터가 폐기된 AT 를 걸러내는 용도다.
 * TTL 은 AT 수명과 같아야 한다 — 그 뒤로는 AT 자체가 만료돼 항목이 필요 없다.
 *
 * <p>sid 없는 구 AT 는 이 목록으로 막지 못한다(필터가 그대로 통과시킨다). legacy RT 로그아웃은 새 세션 행을 만들어
 * 그 id 를 등록하지만, 그 id 를 가진 AT 는 없으므로 헛 키 하나가 TTL 로 사라질 뿐이다.
 *
 * <p>best-effort 다. 운영 business Redis 는 128MiB·allkeys-lru·영속화 없음이라 메모리 압박이면 키가 TTL 전에
 * 축출되고, 재시작·페일오버면 목록 전체가 사라진다. 잃은 sid 의 AT 는 남은 수명(운영 최대 1시간)만큼 통과한다.
 * 최악 노출 상한은 이 목록이 없던 때와 같지만, {@link #isRevoked} 의 차단기와 달리 복구되지 않고 로그도 없다.
 * ponytail: 축출 불가 저장소로 옮기는 건 ticket 2225.
 */
@Slf4j
@Component
public class RevokedSessions {

    /**
     * 운영 Redis ACL 은 business 사용자에게 {@code ~cache:business:*} 키와 get·set 등 일부 명령만 연다
     * ({@code .github/scripts/write-compose-env.py} {@code business_redis_acl}). 그 밖의 키나 EXISTS 를 쓰면
     * NOPERM 으로 기록·조회가 모두 조용히 실패하고 fail-open 으로 폐기 AT 가 전부 통과한다 — 키는 이 접두,
     * 조회는 GET 이어야 한다.
     */
    static final String KEY_PREFIX = "cache:business:revoked-session:";
    /** 서버 간 시계 차이 여유. TTL 은 폐기 시점부터, AT 수명은 발급 시점부터 세므로 원래도 남는 쪽이다. */
    private static final Duration CLOCK_SKEW = Duration.ofSeconds(60);
    /** 조회가 실패하면 이 시간 동안 Redis 를 부르지 않는다 — 장애 중 요청마다 타임아웃(2s)을 물지 않게. */
    static final Duration BREAKER_OPEN = Duration.ofSeconds(30);

    private final StringRedisTemplate redis;
    private final Duration ttl;
    private final Clock clock;
    private volatile Instant skipUntil = Instant.MIN;

    // 생성자가 둘(아래는 테스트용 시계 주입)이라 Spring 이 고를 쪽을 명시한다 — 없으면 기본 생성자를 찾다 기동이 실패한다.
    @Autowired
    public RevokedSessions(StringRedisTemplate redis, @Value("${auth.revoked-session.ttl}") Duration ttl) {
        this(redis, ttl, Clock.systemUTC());
    }

    RevokedSessions(StringRedisTemplate redis, Duration ttl, Clock clock) {
        this.redis = redis;
        this.ttl = ttl;
        this.clock = clock;
    }

    public void revoke(UUID sessionId) {
        redis.opsForValue().set(KEY_PREFIX + sessionId, "1", ttl.plus(CLOCK_SKEW));
    }

    /**
     * Redis 장애 시 fail-open — 인증 전체가 Redis 에 묶여 서비스가 같이 죽는 것을 피한다. 연결 거절은 즉시
     * 실패하지만 패킷을 버리는 장애는 요청마다 명령 타임아웃(2s)을 문다. 그래서 한 번 실패하면 {@link #BREAKER_OPEN}
     * 동안 조회를 건너뛴다.
     */
    // ponytail: fail-open + 30초 차단기. 그 동안 폐기된 AT 는 만료까지 산다. business-api 가 다중 인스턴스가 되면
    // fail-closed + 헬스체크로 바꾼다(장부 ⓨ).
    public boolean isRevoked(UUID sessionId) {
        Instant now = clock.instant();
        if (now.isBefore(skipUntil)) {
            return false;
        }
        try {
            return redis.opsForValue().get(KEY_PREFIX + sessionId) != null;
        } catch (RuntimeException e) {
            skipUntil = now.plus(BREAKER_OPEN);
            log.warn("폐기 세션 조회 실패 — {} 동안 조회를 건너뛰고 fail-open 으로 통과시킨다. sid={}",
                    BREAKER_OPEN, sessionId, e);
            return false;
        }
    }
}

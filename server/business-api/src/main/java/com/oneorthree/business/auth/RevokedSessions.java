package com.oneorthree.business.auth;

import lombok.extern.slf4j.Slf4j;
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
 */
@Slf4j
@Component
public class RevokedSessions {

    private static final String KEY_PREFIX = "auth:business:revoked-session:";
    /** 서버 간 시계 차이 여유. TTL 은 폐기 시점부터, AT 수명은 발급 시점부터 세므로 원래도 남는 쪽이다. */
    private static final Duration CLOCK_SKEW = Duration.ofSeconds(60);
    /** 조회가 실패하면 이 시간 동안 Redis 를 부르지 않는다 — 장애 중 요청마다 타임아웃(2s)을 물지 않게. */
    static final Duration BREAKER_OPEN = Duration.ofSeconds(30);

    private final StringRedisTemplate redis;
    private final Duration ttl;
    private final Clock clock;
    private volatile Instant skipUntil = Instant.MIN;

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
            return Boolean.TRUE.equals(redis.hasKey(KEY_PREFIX + sessionId));
        } catch (RuntimeException e) {
            skipUntil = now.plus(BREAKER_OPEN);
            log.warn("폐기 세션 조회 실패 — {} 동안 조회를 건너뛰고 fail-open 으로 통과시킨다. sid={}",
                    BREAKER_OPEN, sessionId, e);
            return false;
        }
    }
}

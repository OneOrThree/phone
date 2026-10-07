package com.oneorthree.business.auth;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.UUID;

/**
 * 로그아웃·탈퇴로 폐기된 세션 id(sid)의 거부목록. AT 서명·만료만 보는 필터가 폐기된 AT 를 걸러내는 용도다.
 * TTL 은 AT 수명과 같아야 한다 — 그 뒤로는 AT 자체가 만료돼 항목이 필요 없다.
 */
@Slf4j
@Component
public class RevokedSessions {

    private static final String KEY_PREFIX = "auth:business:revoked-session:";

    private final StringRedisTemplate redis;
    private final Duration ttl;

    public RevokedSessions(StringRedisTemplate redis, @Value("${auth.revoked-session.ttl}") Duration ttl) {
        this.redis = redis;
        this.ttl = ttl;
    }

    public void revoke(UUID sessionId) {
        redis.opsForValue().set(KEY_PREFIX + sessionId, "1", ttl);
    }

    /** Redis 장애 시 fail-open — 인증 전체가 Redis 에 묶여 서비스가 같이 죽는 것을 피한다. */
    // ponytail: fail-open 이라 Redis 가 죽은 동안 폐기된 AT 는 만료까지 산다. business-api 가 다중 인스턴스가 되면
    // fail-closed + 헬스체크로 바꾼다(장부 ⓨ).
    public boolean isRevoked(UUID sessionId) {
        try {
            return Boolean.TRUE.equals(redis.hasKey(KEY_PREFIX + sessionId));
        } catch (RuntimeException e) {
            log.warn("폐기 세션 조회 실패 — fail-open 으로 통과시킨다. sid={}", sessionId, e);
            return false;
        }
    }
}

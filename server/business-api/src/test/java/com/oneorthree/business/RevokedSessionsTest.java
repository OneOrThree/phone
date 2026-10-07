package com.oneorthree.business;

import com.oneorthree.business.auth.RevokedSessions;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class RevokedSessionsTest {
    @Container static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @Test
    void revokedSessionIsDeniedWithTtlAndUnknownIsNot() {
        var factory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        factory.afterPropertiesSet();
        try {
            var redis = new StringRedisTemplate(factory);
            var revoked = new RevokedSessions(redis, Duration.ofSeconds(5));
            UUID sid = UUID.randomUUID();

            assertThat(revoked.isRevoked(sid)).isFalse();
            revoked.revoke(sid);

            assertThat(revoked.isRevoked(sid)).isTrue();
            assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();
            assertThat(redis.getExpire("auth:business:revoked-session:" + sid)).isBetween(1L, 5L);
        } finally {
            factory.destroy();
        }
    }

    /** Redis 가 죽어도 인증이 같이 죽지 않는다(fail-open) — 닫힌 포트로 확인한다. */
    @Test
    void redisFailureFailsOpen() {
        var factory = new LettuceConnectionFactory("localhost", 1);
        factory.afterPropertiesSet();
        try {
            var revoked = new RevokedSessions(new StringRedisTemplate(factory), Duration.ofSeconds(5));
            assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();
        } finally {
            factory.destroy();
        }
    }
}

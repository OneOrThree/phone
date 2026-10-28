package com.oneorthree.business;

import com.oneorthree.business.auth.RevokedSessions;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
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
    /**
     * 운영과 같은 business ACL — {@code .github/scripts/write-compose-env.py} {@code business_redis_acl} 의 키 패턴·명령을
     * 그대로 옮겼다. 거부목록이 허용 밖 키나 명령(EXISTS 등)을 쓰면 여기서 NOPERM 으로 깨진다.
     * 운영 ACL 을 바꾸면 이 줄도 같이 바꾼다.
     */
    private static final String BUSINESS_ACL = "ACL SETUSER business on >pw ~cache:business:* "
            + "+get +set +incrby +expire +eval +evalsha +script|load +scan +del "
            + "+ping +hello +info +select +client|setinfo +client|setname";

    @Container static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @Test
    void revokedSessionIsDeniedWithTtlAndUnknownIsNot() throws Exception {
        // 셸을 거치지 않는다 — `+client|setinfo` 의 `|` 를 sh 가 파이프로 읽어 사용자 생성이 깨진다.
        var created = REDIS.execInContainer(("redis-cli " + BUSINESS_ACL).split(" "));
        assertThat(created.getStdout().trim()).isEqualTo("OK");
        var config = new RedisStandaloneConfiguration(REDIS.getHost(), REDIS.getMappedPort(6379));
        config.setUsername("business");
        config.setPassword("pw");
        var factory = new LettuceConnectionFactory(config);
        factory.afterPropertiesSet();
        try {
            var redis = new StringRedisTemplate(factory);
            var revoked = new RevokedSessions(redis, Duration.ofSeconds(5));
            UUID sid = UUID.randomUUID();

            assertThat(revoked.isRevoked(sid)).isFalse();
            revoked.revoke(sid);   // ACL 밖이면 여기서 NOPERM 예외로 테스트가 깨진다

            assertThat(revoked.isRevoked(sid)).isTrue();   // ACL 밖이면 fail-open 으로 false 가 되어 깨진다
            assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();
        } finally {
            factory.destroy();
        }
        // TTL = 설정값(5s) + 시계 차이 여유 60s. TTL 명령은 business ACL 에 없으므로 관리자 연결로 본다.
        var admin = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        admin.afterPropertiesSet();
        try {
            var keys = new StringRedisTemplate(admin).keys("cache:business:revoked-session:*");
            assertThat(keys).hasSize(1);
            assertThat(new StringRedisTemplate(admin).getExpire(keys.iterator().next())).isBetween(60L, 65L);
        } finally {
            admin.destroy();
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

package com.oneorthree.realtime;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.GenericContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("ci")
@Import(RestrictedRedisTestcontainersConfiguration.class)
class ProductionRedisAclTest {

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private GenericContainer<?> redisContainer;

    @Test
    @DisplayName("실제 Spring Redis 연결은 Data의 presence를 읽되 쓰거나 지우지 못한다")
    void presenceIsReadOnlyForTheApplicationConnection() throws Exception {
        String key = "presence:acl-test:" + UUID.randomUUID();
        var seed = redisContainer.execInContainer("redis-cli", "--user", "data", "-a",
                "acl-test-data-password", "--no-auth-warning", "SET", key, "focusing");
        assertThat(seed.getExitCode()).isZero();
        assertThat(seed.getStdout()).contains("OK");
        assertThat(redis.opsForValue().get(key)).isEqualTo("focusing");
        assertThatThrownBy(() -> redis.opsForValue().set(key, "idle")).hasStackTraceContaining("NOPERM");
        assertThatThrownBy(() -> redis.delete(key)).hasStackTraceContaining("NOPERM");
        assertThat(redis.opsForValue().get(key)).isEqualTo("focusing");
    }

    @Test
    @DisplayName("실제 Spring Redis 연결은 다른 서비스 키와 채널을 사용하지 못한다")
    void unrelatedKeysAndChannelsAreDenied() {
        assertThatThrownBy(() -> redis.opsForValue().get("business:acl-test"))
                .hasStackTraceContaining("NOPERM");
        assertThatThrownBy(() -> redis.opsForValue().set("business:acl-test", "value"))
                .hasStackTraceContaining("NOPERM");
        assertThatThrownBy(() -> redis.convertAndSend("business:acl-test", "message"))
                .hasStackTraceContaining("NOPERM");
    }

    @Test
    @DisplayName("default 계정을 닫아 익명 ServiceConnection으로 우회할 수 없다")
    void anonymousConnectionsCannotBypassTheAcl() throws Exception {
        var result = redisContainer.execInContainer("redis-cli", "PING");
        assertThat(result.getStdout()).contains("NOAUTH");
    }
}

package com.oneorthree.business;

import com.oneorthree.business.auth.RevokedSessions;
import com.oneorthree.business.common.redis.BusinessRedisMarkers;
import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.repository.PreviewCache;
import io.lettuce.core.resource.DefaultClientResources;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

@Testcontainers
class BusinessRedisMarkersTest {
    @Container static final GenericContainer<?> OLD = new GenericContainer<>("redis:7.4.11-alpine").withExposedPorts(6379);
    @Container static final GenericContainer<?> SHARED = new GenericContainer<>("redis:7.4.11-alpine").withExposedPorts(6379);

    @Test
    void bridgePreservesLegacyExpiryAndMirrorsNewMarkersWithExistingAcl() throws Exception {
        // 기존 ACL에는 PTTL·HGET·HSET·TIME이 없다. 전환 때문에 그 Redis를 재시작하지 않는다.
        assertThat(OLD.execInContainer("redis-cli", "ACL", "SETUSER", "business", "on", ">old-password",
                "~cache:business:*", "+get", "+set", "+del", "+scan", "+eval", "+evalsha", "+script|load",
                "+hello", "+ping", "+info", "+client|setinfo", "+client|setname").getStdout().trim()).isEqualTo("OK");
        var oldFactory = factory(OLD);
        var newFactory = factory(SHARED);
        var resources = DefaultClientResources.create();
        var old = new StringRedisTemplate(oldFactory);
        var shared = new StringRedisTemplate(newFactory);
        try (var markers = new MarkerScope(new BusinessRedisMarkers(shared, resources, OLD.getHost(),
                OLD.getMappedPort(6379), "business", "old-password"))) {
            String key = "cache:business:revoked-session:" + UUID.randomUUID();
            old.opsForValue().set(key, "1", Duration.ofMillis(600));
            Object expiry = expiresAt(old, key);
            assertThat(markers.value.contains(key)).isTrue();
            assertThat(expiresAt(old, key)).isEqualTo(expiry);
            assertThat(shared.opsForValue().get(key)).isNull();
            await().atMost(Duration.ofSeconds(3)).until(() -> !markers.value.contains(key));

            String next = "cache:business:revoked-session:" + UUID.randomUUID();
            long target = markers.value.put(next, Duration.ofMinutes(1));
            assertThat(expiresAt(old, next)).isEqualTo(target);
            assertThat(expiresAt(shared, next)).isEqualTo(target);
            // 기존 Redis를 분리한 뒤에도 새 저장소에서 차단 기록이 유지된다.
            assertThat(new BusinessRedisMarkers(shared).contains(next)).isTrue();

            String user = UUID.randomUUID().toString();
            String withdrawn = "cache:business:withdrawn:" + user;
            old.opsForValue().set(withdrawn, "1", Duration.ofMinutes(1));
            var cache = new PreviewCache(shared, JsonMapper.builder().build(), markers.value);
            var pending = new PreviewCache.Entry(new Preview("id", "PENDING", "https://example.com",
                    null, null, null, null, null, null), null, "g");
            assertThat(cache.claim(user, pending)).isFalse();
            assertThatThrownBy(() -> cache.checkRate(user, 1)).hasMessage("NOT_FOUND");
            old.opsForValue().set("cache:business:preview:" + user + ":old", "private");
            cache.eraseUser(user);
            assertThat(old.opsForValue().get("cache:business:preview:" + user + ":old")).isNull();
            assertThat(expiresAt(old, withdrawn)).isEqualTo(expiresAt(shared, withdrawn));
        } finally {
            resources.shutdown().get();
            oldFactory.destroy();
            newFactory.destroy();
        }
    }

    @Test
    void existingRevocationIsReadThroughDuringTransition() {
        var oldFactory = factory(OLD);
        var newFactory = factory(SHARED);
        try {
            var old = new StringRedisTemplate(oldFactory);
            var shared = new StringRedisTemplate(newFactory);
            UUID sid = UUID.randomUUID();
            old.opsForValue().set("cache:business:revoked-session:" + sid, "1", Duration.ofMinutes(1));
            var revoked = new RevokedSessions(new BusinessRedisMarkers(shared, old), Duration.ofHours(1));
            assertThat(revoked.isRevoked(sid)).isTrue();
            assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();
        } finally {
            oldFactory.destroy();
            newFactory.destroy();
        }
    }

    private static LettuceConnectionFactory factory(GenericContainer<?> container) {
        var factory = new LettuceConnectionFactory(container.getHost(), container.getMappedPort(6379));
        factory.afterPropertiesSet();
        return factory;
    }

    private static Object expiresAt(StringRedisTemplate redis, String key) {
        return redis.execute(new org.springframework.data.redis.core.script.DefaultRedisScript<>(
                "return redis.call('PEXPIRETIME', KEYS[1])", Long.class), java.util.List.of(key));
    }

    private record MarkerScope(BusinessRedisMarkers value) implements AutoCloseable {
        @Override public void close() {
            value.close();
        }
    }
}

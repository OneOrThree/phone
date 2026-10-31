package com.oneorthree.business;

import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.repository.PreviewCache;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

@Testcontainers
class PreviewCacheTest {
    @Container static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7.4.11-alpine")
            .withCommand("redis-server", "--maxmemory", "128mb", "--maxmemory-policy", "noeviction")
            .withExposedPorts(6379);
    LettuceConnectionFactory factory;
    StringRedisTemplate redis;
    PreviewCache cache;

    @BeforeEach
    void setup() {
        factory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        factory.afterPropertiesSet();
        redis = new StringRedisTemplate(factory);
        try (var connection = factory.getConnection()) {
            connection.serverCommands().flushDb();
        }
        cache = new PreviewCache(redis, JsonMapper.builder().build());
    }

    @AfterEach
    void close() {
        factory.destroy();
    }

    @Test
    void staleWorkerCannotOverwriteReclaimedExpiredSlot() {
        var old = entry("same", "old");
        assertThat(cache.claim("user", old)).isTrue();
        assertThat(cache.claim("user", old)).isFalse();
        redis.expire(slot("user", "same"), Duration.ofMillis(1));
        await().until(() -> cache.find("user", "same") == null);
        var next = entry("same", "next");
        assertThat(cache.claim("user", next)).isTrue();
        cache.complete("user", old, ready(old));
        assertThat(cache.find("user", "same")).isEqualTo(next);
        assertThat(redis.getExpire(slot("user", "same"))).isBetween(80L, 90L);
    }

    @Test
    void concurrentInstancesShareOneGlobalLimit() throws Exception {
        var other = new PreviewCache(redis, JsonMapper.builder().build());
        var workers = Executors.newFixedThreadPool(8);
        try {
            var requests = new ArrayList<java.util.concurrent.Callable<Boolean>>();
            for (int i = 0; i < 96; i++) {
                int id = i;
                requests.add(() -> {
                    try {
                        return (id % 2 == 0 ? cache : other).claim("user-" + id, entry("id", "g"));
                    } catch (PreviewException e) {
                        assertThat(e.getCode()).isEqualTo("BUSY");
                        return false;
                    }
                });
            }
            long admitted = 0;
            for (var result : workers.invokeAll(requests)) {
                if (result.get()) admitted++;
            }
            assertThat(admitted).isEqualTo(64);
            assertThat(redis.keys("cache:business:preview:*")).hasSize(64);
            assertThatThrownBy(() -> cache.claim("overflow", entry("id", "g")))
                    .isInstanceOf(PreviewException.class).hasMessage("BUSY");
        } finally {
            workers.shutdownNow();
        }
    }

    @Test
    void evictsOnlyLeastRecentlyReadCompletedPreviewAndPreservesImportantKeys() {
        List<String> protectedKeys = List.of("cache:business:revoked-session:sid",
                "cache:business:withdrawn:other", "cache:business:rate:other",
                "presence:focus:user", "cache:chat:member:user", "movement:epoch");
        protectedKeys.forEach(key -> redis.opsForValue().set(key, "protected"));
        for (int i = 0; i < 64; i++) assertThat(cache.claim("user", entry("id-" + i, "g"))).isTrue();
        cache.complete("user", entry("id-0", "g"), ready(entry("id-0", "g")));
        cache.complete("user", entry("id-1", "g"), ready(entry("id-1", "g")));
        assertThat(cache.find("user", "id-0").preview().status()).isEqualTo("READY");
        assertThat(cache.claim("new-user", entry("new", "g"))).isTrue();
        assertThat(cache.find("user", "id-1")).isNull();
        assertThat(cache.find("user", "id-0")).isNotNull();
        assertThat(cache.find("user", "id-2").preview().status()).isEqualTo("PENDING");
        protectedKeys.forEach(key -> assertThat(redis.opsForValue().get(key)).isEqualTo("protected"));
        // 포화된 미리보기와 별개로 중요 상태의 추가 쓰기가 가능하다.
        redis.opsForValue().set("presence:focus:another", "active");
        assertThat(redis.opsForValue().get("presence:focus:another")).isEqualTo("active");
    }

    @Test
    void serializedUtf8SizeIsLimitedBeforeClaimAndCompletion() {
        var pending = entry("large", "g");
        var huge = new PreviewCache.Entry(pending.preview(), "가".repeat(360000), "g");
        assertThatThrownBy(() -> cache.claim("user", huge)).hasMessage("CACHE_ENTRY_TOO_LARGE");
        assertThat(redis.keys("cache:business:preview:*")).isEmpty();
        assertThat(cache.claim("user", pending)).isTrue();
        assertThatThrownBy(() -> cache.complete("user", pending, huge)).hasMessage("CACHE_ENTRY_TOO_LARGE");
        assertThat(cache.find("user", "large")).isEqualTo(pending);
    }

    @Test
    void fullPayloadBudgetStillAllowsPresenceAndRevocationWrites() {
        String thumbnail = "A".repeat(1024 * 1024 - 2048);
        for (int i = 0; i < 64; i++) {
            var pending = entry("id-" + i, "g");
            assertThat(cache.claim("user", pending)).isTrue();
            cache.complete("user", pending, new PreviewCache.Entry(ready(pending).preview(), thumbnail, "g"));
        }
        redis.opsForValue().set("presence:focus:new-user", "active", Duration.ofMinutes(1));
        redis.opsForValue().set("cache:business:revoked-session:new-sid", "1", Duration.ofHours(1));
        assertThat(redis.keys("cache:business:preview:*")).hasSize(64);
        assertThat(redis.opsForValue().get("cache:business:revoked-session:new-sid")).isEqualTo("1");
    }

    @Test
    void withdrawnUserCopiesCannotBeRecreatedAndOtherUsersArePreserved() {
        var inFlight = entry("in-flight", "g1");
        assertThat(cache.claim("user", inFlight)).isTrue();
        assertThat(cache.claim("user", entry("ready", "g2"))).isTrue();
        cache.checkRate("user", 4);
        assertThat(cache.claim("other-user", entry("ready", "g3"))).isTrue();
        assertThat(cache.eraseUser("user")).isEqualTo(3);
        assertThat(cache.find("user", "in-flight")).isNull();
        assertThat(cache.find("user", "ready")).isNull();
        assertThat(cache.find("other-user", "ready")).isNotNull();
        assertThat(redis.getExpire("cache:business:withdrawn:user")).isBetween(7100L, 7200L);
        cache.complete("user", inFlight, ready(inFlight));
        assertThat(cache.claim("user", entry("late", "g4"))).isFalse();
        assertThatThrownBy(() -> cache.checkRate("user", 1)).hasMessage("NOT_FOUND");
        assertThat(cache.eraseUser("user")).isZero();
        assertThat(cache.find("user", "in-flight")).isNull();
    }

    @Test
    void allOperationsWorkWithBusinessAclAndOtherNamespacesAreDenied() throws Exception {
        String acl = "ACL SETUSER business on >pw ~cache:business:* "
                + "+get +set +incrby +expire +eval +evalsha +script|load +hget +hset +time +del "
                + "+ping +hello +info +select +client|setinfo +client|setname";
        assertThat(REDIS.execInContainer(("redis-cli " + acl).split(" ")).getStdout().trim()).isEqualTo("OK");
        var config = new RedisStandaloneConfiguration(REDIS.getHost(), REDIS.getMappedPort(6379));
        config.setUsername("business");
        config.setPassword("pw");
        var restricted = new LettuceConnectionFactory(config);
        restricted.afterPropertiesSet();
        try {
            var client = new StringRedisTemplate(restricted);
            var limited = new PreviewCache(client, JsonMapper.builder().build());
            var pending = entry("id", "g");
            limited.checkRate("user", 4);
            assertThat(limited.claim("user", pending)).isTrue();
            limited.complete("user", pending, ready(pending));
            assertThat(limited.find("user", "id").preview().status()).isEqualTo("READY");
            assertThat(limited.eraseUser("user")).isEqualTo(2);
            assertThatThrownBy(() -> client.opsForValue().set("presence:focus:other", "1"))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThatThrownBy(() -> client.convertAndSend("chat:fanout", "message"))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
        } finally {
            restricted.destroy();
        }
    }

    private String slot(String user, String id) {
        return redis.keys("cache:business:preview:slot:v1:*").stream()
                .filter(key -> (user + ":" + id).equals(redis.opsForHash().get(key, "identity")))
                .findFirst().orElseThrow();
    }

    private static PreviewCache.Entry entry(String id, String generation) {
        return new PreviewCache.Entry(new Preview(id, "PENDING", "https://example.com/" + id,
                null, null, null, null, null, null), null, generation);
    }

    private static PreviewCache.Entry ready(PreviewCache.Entry pending) {
        var p = pending.preview();
        return new PreviewCache.Entry(new Preview(p.id(), "READY", p.originalUrl(), "title",
                "image/png", 1L, "FILE", null, null), "AQID", pending.generation());
    }
}

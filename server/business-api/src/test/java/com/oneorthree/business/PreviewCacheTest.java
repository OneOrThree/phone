package com.oneorthree.business;

import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import com.oneorthree.business.linkpreview.repository.PreviewCache;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class PreviewCacheTest {
    @Container static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @Test
    void staleWorkerCannotOverwriteNewGeneration() {
        var factory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        factory.afterPropertiesSet();
        try {
            var redis = new StringRedisTemplate(factory);
            var cache = new PreviewCache(redis, JsonMapper.builder().build());
            var pending = new Preview("id", "PENDING", "https://example.com", null, null, null, null, null, null);
            var old = new PreviewCache.Entry(pending, null, "old");
            assertThat(cache.claim("user", old)).isTrue();
            assertThat(cache.claim("user", old)).isFalse();
            redis.delete("cache:business:preview:user:id");
            var next = new PreviewCache.Entry(pending, null, "next");
            assertThat(cache.claim("user", next)).isTrue();
            cache.complete("user", old, new PreviewCache.Entry(pending, "old-thumbnail", "old"));
            assertThat(cache.find("user", "id")).isEqualTo(next);
            assertThat(redis.getExpire("cache:business:preview:user:id")).isBetween(80L, 90L);
        } finally {
            factory.destroy();
        }
    }

    /** 탈퇴자 사본 파기(GROMO-1943) — 지운 뒤 늦은 요청·워커가 되살리지 못하고, 재전달은 같은 결과다. */
    @Test
    void withdrawnUserCopiesAreErasedAndCannotBeRecreated() {
        var factory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        factory.afterPropertiesSet();
        try {
            var redis = new StringRedisTemplate(factory);
            var cache = new PreviewCache(redis, JsonMapper.builder().build());
            String user = "withdrawn-user";
            var inFlight = entry("in-flight", "g1");
            assertThat(cache.claim(user, inFlight)).isTrue();
            assertThat(cache.claim(user, entry("ready", "g2"))).isTrue();
            cache.checkRate(user, 4);
            assertThat(cache.claim("other-user", entry("ready", "g3"))).isTrue();
            assertThat(userKeys(redis, user)).isEqualTo(3);

            assertThat(cache.eraseUser(user)).isEqualTo(3);

            assertThat(userKeys(redis, user)).isZero();
            assertThat(redis.hasKey("cache:business:withdrawn:" + user)).isTrue();
            assertThat(redis.hasKey("cache:business:preview:other-user:ready")).isTrue();

            // 표지가 있는 동안: 진행 중이던 워커의 완료·새 선점·레이트 검사가 사본을 만들지 못한다.
            cache.complete(user, inFlight, new PreviewCache.Entry(inFlight.preview(), "thumb", "g1"));
            assertThat(cache.claim(user, entry("late", "g4"))).isFalse();
            assertThatThrownBy(() -> cache.checkRate(user, 1)).isInstanceOf(PreviewException.class)
                    .hasMessage("NOT_FOUND");
            assertThat(userKeys(redis, user)).isZero();

            // 같은 탈퇴의 재처리 — 키 수가 1회 때와 같다.
            assertThat(cache.eraseUser(user)).isZero();
            assertThat(userKeys(redis, user)).isZero();
        } finally {
            factory.destroy();
        }
    }

    private static PreviewCache.Entry entry(String id, String generation) {
        return new PreviewCache.Entry(new Preview(id, "PENDING", "https://example.com/" + id,
                null, null, null, null, null, null), null, generation);
    }

    /** 사용자에 연결된 사본 키 수 — 미리보기 + 레이트(차단 표지는 사본이 아니라 세지 않는다). */
    private static int userKeys(StringRedisTemplate redis, String user) {
        return redis.keys("cache:business:preview:" + user + ":*").size()
                + (Boolean.TRUE.equals(redis.hasKey("cache:business:rate:" + user)) ? 1 : 0);
    }
}

package com.oneorthree.business;

import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.repository.PreviewCache;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

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
}

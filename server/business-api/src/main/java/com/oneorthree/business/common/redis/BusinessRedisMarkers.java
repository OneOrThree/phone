package com.oneorthree.business.common.redis;

import io.lettuce.core.resource.ClientResources;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * 세션·탈퇴 차단 표지의 Redis 전환. 기존 저장소의 TTL을 바꾸지 않고 읽으며 새 표지는 양쪽에 쓴다.
 * 기존 Redis는 최대 표지 수명이 지난 뒤 분리한다. 일반 캐시에는 이중 저장을 적용하지 않는다.
 */
@Component
public class BusinessRedisMarkers {
    private static final DefaultRedisScript<Long> PUT = new DefaultRedisScript<>("""
            redis.call('SET', KEYS[1], '1', 'PXAT', ARGV[1])
            return 1
            """, Long.class);
    private final StringRedisTemplate redis;
    private final StringRedisTemplate legacy;
    private final LettuceConnectionFactory legacyFactory;

    @Autowired
    public BusinessRedisMarkers(StringRedisTemplate redis, ClientResources resources,
            @Value("${business.redis.legacy-host:}") String host,
            @Value("${business.redis.legacy-port:6379}") int port,
            @Value("${business.redis.legacy-username:business}") String username,
            @Value("${business.redis.legacy-password:}") String password) {
        this.redis = redis;
        if (host.isBlank()) {
            legacyFactory = null;
            legacy = null;
        } else {
            if (password.isBlank()) {
                throw new IllegalArgumentException("Legacy Business Redis password required");
            }
            var config = new RedisStandaloneConfiguration(host, port);
            config.setUsername(username);
            config.setPassword(password);
            var client = LettuceClientConfiguration.builder().clientResources(resources)
                    .commandTimeout(Duration.ofSeconds(2)).build();
            legacyFactory = new LettuceConnectionFactory(config, client);
            legacyFactory.afterPropertiesSet();
            legacyFactory.start();
            legacy = new StringRedisTemplate(legacyFactory);
        }
    }

    public BusinessRedisMarkers(StringRedisTemplate redis) {
        this(redis, null);
    }

    public BusinessRedisMarkers(StringRedisTemplate redis, StringRedisTemplate legacy) {
        this.redis = redis;
        this.legacy = legacy;
        legacyFactory = null;
    }

    public boolean contains(String key) {
        return redis.opsForValue().get(key) != null || legacy != null && legacy.opsForValue().get(key) != null;
    }

    public long put(String key, Duration ttl) {
        long expiresAt = System.currentTimeMillis() + ttl.toMillis();
        String expiry = Long.toString(expiresAt);
        redis.execute(PUT, List.of(key), expiry);
        if (legacy != null) {
            // 동일한 절대 만료 시각을 사용한다. 일부 저장 실패는 호출자에게 전달해 성공으로 숨기지 않는다.
            legacy.execute(PUT, List.of(key), expiry);
        }
        return expiresAt;
    }

    /** 전환 중 남아 있는 이전 형식의 개인 미리보기도 탈퇴 시 제거한다. */
    public void eraseLegacyPreviews(String user) {
        if (legacy == null) {
            return;
        }
        try (var cursor = legacy.scan(ScanOptions.scanOptions()
                .match("cache:business:preview:" + user + ":*").count(100).build())) {
            while (cursor.hasNext()) {
                legacy.delete(cursor.next());
            }
        }
        legacy.delete("cache:business:rate:" + user);
    }

    @PreDestroy
    public void close() {
        if (legacyFactory != null) {
            legacyFactory.destroy();
        }
    }
}

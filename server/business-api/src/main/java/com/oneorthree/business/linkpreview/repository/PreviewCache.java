package com.oneorthree.business.linkpreview.repository;

import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.time.Duration;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

@Repository
public class PreviewCache {

    public record Entry(Preview preview, String thumbnailBase64, String generation) {
    }

    private static final DefaultRedisScript<Long> COMPLETE = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then
                redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
                return 1
            end
            return 0
            """, Long.class);
    private static final DefaultRedisScript<Long> RATE = new DefaultRedisScript<>("""
            local n = redis.call('INCRBY', KEYS[1], ARGV[1])
            if n == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], 60) end
            return n
            """, Long.class);
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public PreviewCache(StringRedisTemplate redis, ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    public Entry find(String user, String id) {
        String json = redis.opsForValue().get(key(user, id));
        return json == null ? null : mapper.readValue(json, Entry.class);
    }

    public boolean claim(String user, Entry pending) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key(user, pending.preview().id()),
                mapper.writeValueAsString(pending), Duration.ofSeconds(90)));
    }

    public void complete(String user, Entry pending, Entry result) {
        redis.execute(COMPLETE, List.of(key(user, pending.preview().id())), mapper.writeValueAsString(pending),
                mapper.writeValueAsString(result), "READY".equals(result.preview().status()) ? "300" : "30");
    }

    public void checkRate(String user, int cost) {
        Long count = redis.execute(RATE, List.of("cache:business:rate:" + user), Integer.toString(cost));
        if (count == null || count > 240) {
            throw new PreviewException("RATE_LIMITED");
        }
    }

    private String key(String user, String id) {
        // 사용자별 격리: 미리보기 ID만 아는 다른 사용자는 원본·썸네일을 열 수 없다.
        return "cache:business:preview:" + user + ":" + id;
    }
}

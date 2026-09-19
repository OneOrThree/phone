package com.oneorthree.business.linkpreview.repository;

import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * 미리보기 캐시 — 사용자 UUID 키에 원본 URL·썸네일을 담는 사본이다.
 *
 * <p><b>탈퇴 차단 표지</b>({@code cache:business:withdrawn:{userId}}, GROMO-1943 · 계정 LLD §4): 탈퇴가
 * 확정되면 {@link #eraseUser} 가 표지를 놓고 그 사용자의 키를 지운다. 표지가 있는 동안 레이트 검사·선점이
 * 같은 스크립트 안에서 표지를 대조해 거절하므로, 탈퇴 전에 발급된 AT 로 온 요청이나 진행 중이던 워커가
 * 지운 뒤에 사본을 다시 만들지 못한다(완료는 선점 값이 그대로일 때만 쓰므로 선점이 막히면 같이 막힌다).
 */
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
    private static final DefaultRedisScript<Long> CLAIM = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[2]) then return 0 end
            if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', 90) then return 1 end
            return 0
            """, Long.class);
    private static final DefaultRedisScript<Long> RATE = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[2]) then return -1 end
            local n = redis.call('INCRBY', KEYS[1], ARGV[1])
            if n == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], 60) end
            return n
            """, Long.class);
    /**
     * 탈퇴 표지 수명. 막아야 하는 것은 «탈퇴 전에 발급된 AT» 로 오는 요청이고 AT 수명은 최대 1시간이다 —
     * 그 뒤에는 표지 없이도 인증에서 걸린다. 넉넉히 두 배를 둔다.
     */
    private static final Duration WITHDRAWN_TTL = Duration.ofHours(2);
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
        return Long.valueOf(1).equals(redis.execute(CLAIM, List.of(key(user, pending.preview().id()),
                withdrawnKey(user)), mapper.writeValueAsString(pending)));
    }

    public void complete(String user, Entry pending, Entry result) {
        redis.execute(COMPLETE, List.of(key(user, pending.preview().id())), mapper.writeValueAsString(pending),
                mapper.writeValueAsString(result), "READY".equals(result.preview().status()) ? "300" : "30");
    }

    public void checkRate(String user, int cost) {
        Long count = redis.execute(RATE, List.of(rateKey(user), withdrawnKey(user)), Integer.toString(cost));
        if (count != null && count < 0) {
            // 탈퇴한 사용자 — 남은 AT 로 온 요청이다. 사본이 없다는 것만 알린다.
            throw new PreviewException("NOT_FOUND");
        }
        if (count == null || count > 240) {
            throw new PreviewException("RATE_LIMITED");
        }
    }

    /**
     * 탈퇴 확정 뒤 그 사용자의 미리보기·레이트 키를 지우고 차단 표지를 놓는다. 여러 번 불러도 결과가 같다.
     *
     * <p>표지를 «먼저» 놓는다 — 그 뒤로는 새 키가 생기지 않으므로, 이어지는 SCAN 이 지울 대상을 빠짐없이
     * 본다(SCAN 은 순회 내내 존재한 키를 반드시 돌려준다).
     *
     * @return 지운 키 수
     */
    public long eraseUser(String user) {
        redis.opsForValue().set(withdrawnKey(user), "1", WITHDRAWN_TTL);
        List<String> keys = new ArrayList<>();
        keys.add(rateKey(user));
        try (Cursor<String> cursor = redis.scan(ScanOptions.scanOptions()
                .match(key(user, "*")).count(500).build())) {
            cursor.forEachRemaining(keys::add);
        }
        Long deleted = redis.delete(keys);
        return deleted == null ? 0 : deleted;
    }

    private static String rateKey(String user) {
        return "cache:business:rate:" + user;
    }

    private static String withdrawnKey(String user) {
        return "cache:business:withdrawn:" + user;
    }

    private String key(String user, String id) {
        // 사용자별 격리: 미리보기 ID만 아는 다른 사용자는 원본·썸네일을 열 수 없다.
        return "cache:business:preview:" + user + ":" + id;
    }
}

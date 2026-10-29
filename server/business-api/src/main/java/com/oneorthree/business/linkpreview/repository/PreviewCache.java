package com.oneorthree.business.linkpreview.repository;

import com.oneorthree.business.common.redis.BusinessRedisMarkers;
import com.oneorthree.business.linkpreview.dto.Preview;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * 공유 Redis의 미리보기 저장소. 64개 고정 슬롯에 항목당 최대 1MiB를 저장한다.
 *
 * <p>키·해시 메타데이터·Redis 관리 메모리는 payload 예산과 별도다. 처리 중인 슬롯은 축출하지 않고,
 * 완료된 슬롯만 최근 조회 순서로 교체한다. 모든 슬롯 키를 Lua에 명시해 선점·완료·탈퇴 정리가
 * 여러 인스턴스에서도 원자적으로 동작한다. 세션 거부목록·탈퇴 표지·레이트 키는 축출하지 않는다.
 */
@Repository
public class PreviewCache {

    public record Entry(Preview preview, String thumbnailBase64, String generation) {
    }

    private static final int MAX_ENTRY_BYTES = 1024 * 1024;
    private static final List<String> SLOTS = IntStream.range(0, 64)
            .mapToObj(index -> "cache:business:preview:slot:v1:" + index).toList();
    private static final DefaultRedisScript<String> FIND = script("find", String.class);
    private static final DefaultRedisScript<Long> CLAIM = script("claim", Long.class);
    private static final DefaultRedisScript<Long> COMPLETE = script("complete", Long.class);
    private static final DefaultRedisScript<Long> ERASE = script("erase", Long.class);
    private static final DefaultRedisScript<Long> RATE = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[2]) then return -1 end
            local n = redis.call('INCRBY', KEYS[1], ARGV[1])
            if n == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], 60) end
            return n
            """, Long.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final BusinessRedisMarkers markers;

    public PreviewCache(StringRedisTemplate redis, ObjectMapper mapper) {
        this(redis, mapper, new BusinessRedisMarkers(redis));
    }

    @Autowired
    public PreviewCache(StringRedisTemplate redis, ObjectMapper mapper, BusinessRedisMarkers markers) {
        this.redis = redis;
        this.mapper = mapper;
        this.markers = markers;
    }

    public Entry find(String user, String id) {
        String json = redis.execute(FIND, keys(withdrawnKey(user)), identity(user, id));
        return json == null ? null : mapper.readValue(json, Entry.class);
    }

    /** 중복·탈퇴 표지는 false, 슬롯 포화는 BUSY다. */
    public boolean claim(String user, Entry pending) {
        if (markers.contains(withdrawnKey(user))) {
            return false;
        }
        Long result = redis.execute(CLAIM, keys(withdrawnKey(user)), identity(user, pending.preview().id()),
                user, pending.generation(), encode(pending));
        if (Long.valueOf(-1).equals(result)) {
            throw new PreviewException("BUSY");
        }
        return Long.valueOf(1).equals(result);
    }

    public void complete(String user, Entry pending, Entry result) {
        if (markers.contains(withdrawnKey(user))) {
            return;
        }
        redis.execute(COMPLETE, keys(withdrawnKey(user)), identity(user, pending.preview().id()),
                pending.generation(), encode(result), "READY".equals(result.preview().status()) ? "300" : "30");
    }

    public void checkRate(String user, int cost) {
        if (markers.contains(withdrawnKey(user))) {
            throw new PreviewException("NOT_FOUND");
        }
        Long count = redis.execute(RATE, List.of(rateKey(user), withdrawnKey(user)), Integer.toString(cost));
        if (count != null && count < 0) {
            throw new PreviewException("NOT_FOUND");
        }
        if (count == null || count > 240) {
            throw new PreviewException("RATE_LIMITED");
        }
    }

    /** 표지 기록과 해당 사용자 슬롯·레이트 삭제를 함께 수행해 늦은 워커의 사본 재생성도 막는다. */
    public long eraseUser(String user) {
        long expiry = markers.put(withdrawnKey(user), Duration.ofHours(2));
        Long deleted = redis.execute(ERASE, keys(withdrawnKey(user), rateKey(user)), user, Long.toString(expiry));
        markers.eraseLegacyPreviews(user);
        return deleted == null ? 0 : deleted;
    }

    private String encode(Entry entry) {
        String json = mapper.writeValueAsString(entry);
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_ENTRY_BYTES) {
            throw new PreviewException("CACHE_ENTRY_TOO_LARGE");
        }
        return json;
    }

    private static String identity(String user, String id) {
        // 메타데이터 자체도 고정 상한 안에 둔다. 정상 입력은 UUID와 SHA-256 id다.
        if (user.length() > 128 || id.length() > 128 || user.contains(":") || id.contains(":")) {
            throw new IllegalArgumentException("Invalid preview identity");
        }
        return user + ":" + id;
    }

    private static List<String> keys(String... additional) {
        List<String> keys = new ArrayList<>(SLOTS);
        keys.addAll(List.of(additional));
        return keys;
    }

    private static <T> DefaultRedisScript<T> script(String name, Class<T> type) {
        var script = new DefaultRedisScript<T>();
        script.setLocation(new ClassPathResource("redis/preview-" + name + ".lua"));
        script.setResultType(type);
        return script;
    }

    private static String rateKey(String user) {
        return "cache:business:rate:" + user;
    }

    private static String withdrawnKey(String user) {
        return "cache:business:withdrawn:" + user;
    }
}

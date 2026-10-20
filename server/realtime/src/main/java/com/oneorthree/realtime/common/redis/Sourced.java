package com.oneorthree.realtime.common.redis;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Redis 캐시에서 읽은 값과 <b>그 값의</b> 절대 만료 시각({@link System#nanoTime} 기준) — 한 원자 단위(Lua)로 함께 읽는다.
 *
 * <p>값과 PTTL 을 따로 읽으면 그 사이에 다른 요청이 키를 새 값·새 TTL 로 갈아 끼울 수 있다. 그러면 옛 값으로 내린 판정이 새
 * 값의 수명을 얻는다(GROMO-2340 — 전달 직전 인가 캐시가 강퇴·차단 반영 상한을 넘기던 경합). 그래서 둘은 늘 같이 읽는다.
 *
 * @param value 판정에 쓴 값
 * @param expiresAtNanos 그 값의 만료 — {@link #UNBOUNDED}(수명 없음·원본 없음), {@link #EXPIRED}(키 없음·담지 말 것)
 */
public record Sourced<T>(T value, long expiresAtNanos) {

    public static final long UNBOUNDED = Long.MAX_VALUE;
    public static final long EXPIRED = Long.MIN_VALUE;

    /**
     * {@code KEYS[1]} 의 값과 PTTL, 있으면 {@code KEYS[2]} 의 값까지 한 번에 — 없는 값은 빈 문자열, PTTL 은 문자열(-2 없음, -1
     * 수명 없음). 결과를 전부 문자열로 돌려 Lua nil·정수 변환 차이에 기대지 않는다.
     */
    @SuppressWarnings("rawtypes")
    public static final RedisScript<List> GET_WITH_PTTL = new DefaultRedisScript<>(
                    "local r = {redis.call('GET', KEYS[1]) or '', tostring(redis.call('PTTL', KEYS[1]))}\n"
                            + "if #KEYS > 1 then r[3] = redis.call('GET', KEYS[2]) or '' end\n"
                            + "return r", List.class);

    /**
     * PTTL → 절대 만료.
     *
     * @param readStartNanos 읽기 «전»의 nanoTime — 왕복 시간만큼 이르게 잡아 실제 만료를 넘지 않는다
     */
    public static long expiresAt(long readStartNanos, long pttlMillis) {
        if (pttlMillis == -1) {
            return UNBOUNDED;
        }
        if (pttlMillis < 0) {
            return EXPIRED;
        }
        return readStartNanos + TimeUnit.MILLISECONDS.toNanos(pttlMillis);
    }

    /**
     * 키의 값들과 첫 키의 만료를 한 원자 단위로 읽는다 — 값은 {@code keys} 순서의 문자열(없으면 빈 문자열), 만료는 첫 키 기준.
     * 키는 1~2개({@link #GET_WITH_PTTL} 의 계약).
     *
     * @throws IllegalStateException 응답이 비었거나 키 수와 맞지 않을 때
     */
    @SuppressWarnings("unchecked")
    public static Sourced<List<String>> read(StringRedisTemplate redis, String... keys) {
        if (keys.length < 1 || keys.length > 2) {
            throw new IllegalArgumentException("키는 1~2개여야 합니다: " + keys.length);
        }
        long readStart = System.nanoTime();
        List<Object> read = redis.execute(GET_WITH_PTTL, List.of(keys));
        if (read == null || read.size() != keys.length + 1) {
            throw new IllegalStateException("캐시 읽기 스크립트 응답이 비었거나 키 수와 안 맞는다");
        }
        List<String> values = new ArrayList<>(keys.length);
        values.add(String.valueOf(read.get(0)));
        if (keys.length > 1) {
            values.add(String.valueOf(read.get(2)));
        }
        return new Sourced<>(values, expiresAt(readStart, Long.parseLong(String.valueOf(read.get(1)))));
    }
}

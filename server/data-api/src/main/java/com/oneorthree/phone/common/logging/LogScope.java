package com.oneorthree.phone.common.logging;

import org.slf4j.MDC;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 자기가 넣은 앱 MDC 키만 이전 값으로 되돌리는 scope (GROMO-2557, 로그 계약 §2.2).
 *
 * <p>값은 넣는 순간 형식을 검사한다. 어긋난 값은 싣지 않고 그 키를 scope 동안 비워 둔다 — 바깥 문맥의 같은 키가 남아
 * 다른 사건의 로그로 잘못 묶이지 않게 한다. {@link #close()} 는 이 scope 가 처음 건드린 키의 이전 값만 되돌린다
 * (없었으면 지운다). 전체 {@code MDC.clear()} 는 하지 않으며 tracer 소유 {@code dd.*} 는 건드리지 않는다.
 *
 * <p>설치한 스레드에서 닫아야 한다 — try-with-resources 로만 쓴다.
 */
public final class LogScope implements AutoCloseable {

    /** 로그 계약 §2.1 의 ID 류 형식. */
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_.:-]{1,128}");
    private static final int MAX_ATTEMPT = 1_000_000;

    /** 처음 건드린 키 → 그때의 값({@code null} = 없었다). */
    private final Map<String, String> previous = new LinkedHashMap<>();

    private LogScope() {
    }

    /** @return 빈 scope */
    public static LogScope open() {
        return new LogScope();
    }

    /**
     * @param value 후보
     * @return §2.1 ID 형식이면 그대로, 아니면 {@code null}
     */
    public static String safeId(String value) {
        return value != null && SAFE_ID.matcher(value).matches() ? value : null;
    }

    /**
     * ID 류 키를 넣는다. 형식이 어긋나거나 {@code null} 이면 scope 동안 그 키를 비운다.
     *
     * @param key   MDC 키
     * @param value 값
     * @return 이 scope
     */
    public LogScope id(String key, Object value) {
        return set(key, safeId(value == null ? null : value.toString()));
    }

    /**
     * 시도 번호를 넣는다 — 1..1000000 밖이면 비운다.
     *
     * @param attempt 시도 번호
     * @return 이 scope
     */
    public LogScope attempt(long attempt) {
        return set("attempt", attempt >= 1 && attempt <= MAX_ATTEMPT ? Long.toString(attempt) : null);
    }

    /**
     * 코드가 정한 고정 값(예: {@code event_name})을 넣는다.
     *
     * @param key   MDC 키
     * @param value 값 — {@code null} 이면 비운다
     * @return 이 scope
     */
    public LogScope set(String key, String value) {
        if (!previous.containsKey(key)) {
            previous.put(key, MDC.get(key));
        }
        if (value == null) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
        return this;
    }

    @Override
    public void close() {
        previous.forEach((key, value) -> {
            if (value == null) {
                MDC.remove(key);
            } else {
                MDC.put(key, value);
            }
        });
    }
}

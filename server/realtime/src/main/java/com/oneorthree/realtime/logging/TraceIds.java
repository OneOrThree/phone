package com.oneorthree.realtime.logging;

import java.util.Locale;
import java.util.regex.Pattern;

/** Datadog 이벤트 MDC 의 trace/span 원문을 canonical 소문자 hex 로 바꾼다. 확실하지 않으면 null 이다. */
final class TraceIds {

    private static final Pattern RAW = Pattern.compile("[0-9A-Fa-f]{1,32}");
    private static final Pattern HEX_128 = Pattern.compile("[0-9A-Fa-f]{32}");
    private static final Pattern DECIMAL = Pattern.compile("[0-9]{1,20}");

    private TraceIds() {
    }

    /** dd 원문 보존용 형식 검사. 0·빈 값·형식 밖이면 null(활성 trace 없음). */
    static String raw(String value) {
        return value != null && RAW.matcher(value).matches() && !isZero(value) ? value : null;
    }

    /** 32자리 hex 만 소문자로. 10진은 128-bit 상위 64비트를 잃었을 수 있어 만들지 않는다. */
    static String traceId(String value) {
        return value != null && HEX_128.matcher(value).matches() && !isZero(value)
                ? value.toLowerCase(Locale.ROOT) : null;
    }

    /** unsigned 64비트 10진 span → 16자리 hex. */
    static String spanId(String value) {
        if (value == null || !DECIMAL.matcher(value).matches()) {
            return null;
        }
        try {
            long id = Long.parseUnsignedLong(value);
            return id == 0 ? null : String.format("%016x", id);
        } catch (NumberFormatException outOfRange) {
            return null;
        }
    }

    private static boolean isZero(String value) {
        return value.chars().allMatch(c -> c == '0');
    }
}

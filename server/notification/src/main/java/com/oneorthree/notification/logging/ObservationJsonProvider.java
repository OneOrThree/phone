package com.oneorthree.notification.logging;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import org.springframework.boot.json.JsonWriter;
import org.springframework.boot.logging.structured.StructuredLogFormatter;
import org.springframework.core.env.Environment;

import java.nio.charset.StandardCharsets;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 관측 JSON 한 줄(schema_version 1). {@code logging.structured.format.console} 이 이 클래스를 가리킨다.
 * 이벤트의 MDC 스냅샷만 읽고, allowlist 밖 MDC·key/value 는 내보내지 않는다. 접근 로그(access)는 이 서비스 범위 밖이다.
 */
public final class ObservationJsonProvider implements StructuredLogFormatter<ILoggingEvent> {

    static final int MESSAGE_LIMIT_BYTES = 16 * 1024;
    static final int EXCEPTION_LIMIT_BYTES = 32 * 1024;

    private static final JsonWriter<Map<String, Object>> JSON =
            JsonWriter.<Map<String, Object>>standard().withNewLineAtEnd();
    private static final DateTimeFormatter TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final Pattern META = Pattern.compile("[A-Za-z0-9._:@/+-]{1,200}");
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_.:-]{1,128}");
    private static final Pattern ATTEMPT = Pattern.compile("[0-9]{1,7}");
    private static final List<String> ID_KEYS = List.of("request_id", "origin_request_id", "origin_trace_id",
            "user_id", "event_id", "delivery_id", "operation_id", "message_id", "edge_request_id");
    private static final Set<String> EVENT_NAMES = Set.of("operation.link", "outbox.delivery", "consumer.accept",
            "transport.result", "dispatch.settle", "fanout.publish", "fanout.receive");

    private final Map<String, String> runtime;

    public ObservationJsonProvider(Environment environment) {
        Map<String, String> values = new LinkedHashMap<>();
        putRuntime(values, "service", environment, "OBS_SERVICE");
        putRuntime(values, "env", environment, "OBS_ENV");
        putRuntime(values, "version", environment, "OBS_VERSION");
        putRuntime(values, "instance_id", environment, "HOSTNAME");
        this.runtime = Collections.unmodifiableMap(values);
    }

    @Override
    public String format(ILoggingEvent event) {
        try {
            return JSON.writeToString(fields(event));
        } catch (RuntimeException failure) {
            // 이벤트를 잃지 않되 같은 logger 를 다시 부르지 않는다.
            Map<String, Object> fallback = header(event);
            fallback.put("message", "log format failed: " + failure.getClass().getName());
            return JSON.writeToString(fallback);
        }
    }

    private Map<String, Object> fields(ILoggingEvent event) {
        Map<String, Object> out = header(event);
        long original = putLimited(out, "message",
                Objects.toString(event.getFormattedMessage(), ""), MESSAGE_LIMIT_BYTES);
        IThrowableProxy throwable = event.getThrowableProxy();
        if (throwable != null) {
            original += putLimited(out, "exception",
                    ThrowableProxyUtil.asString(throwable), EXCEPTION_LIMIT_BYTES);
        }
        if (original > 0) {
            out.put("truncated", true);
            out.put("original_size_bytes", original);
        }
        Map<String, String> mdc = event.getMDCPropertyMap();
        if (mdc != null) {
            putTrace(out, mdc);
            putContext(out, mdc);
        }
        return out;
    }

    private Map<String, Object> header(ILoggingEvent event) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("schema_version", 1);
        out.put("log_id", UUID.randomUUID().toString());
        out.put("log_kind", "application");
        out.put("timestamp", TIMESTAMP.format(event.getInstant()));
        out.put("level", String.valueOf(event.getLevel()));
        out.put("logger", event.getLoggerName());
        out.put("thread", event.getThreadName());
        out.putAll(runtime);
        return out;
    }

    /**
     * 원본이 한도의 2배를 넘으면 마스킹 전에 UTF-8 문자 경계에서 먼저 자르고(마스킹 비용을 출력 상한에 묶는다),
     * 마스킹 뒤 다시 한도로 자른다. 잘렸으면 원래 바이트 수를, 아니면 0 을 돌려준다.
     */
    private static long putLimited(Map<String, Object> out, String field, String raw, int limit) {
        byte[] rawBytes = raw.getBytes(StandardCharsets.UTF_8);
        boolean preCut = rawBytes.length > limit * 2L;
        String masked = LogMasking.mask(preCut ? cutUtf8(rawBytes, limit * 2) : raw);
        byte[] bytes = masked.getBytes(StandardCharsets.UTF_8);
        boolean cut = bytes.length > limit;
        out.put(field, cut ? cutUtf8(bytes, limit) : masked);
        if (preCut) {
            return rawBytes.length;
        }
        return cut ? bytes.length : 0;
    }

    /** {@code bytes.length > limit} 인 UTF-8 바이트열을 문자 경계에서 limit 이하로 잘라 문자열로 돌려준다. */
    private static String cutUtf8(byte[] bytes, int limit) {
        int end = limit;
        while (end > 0 && (bytes[end] & 0xC0) == 0x80) {
            end--;
        }
        return new String(bytes, 0, end, StandardCharsets.UTF_8);
    }

    private static void putTrace(Map<String, Object> out, Map<String, String> mdc) {
        String trace = TraceIds.raw(mdc.get("dd.trace_id"));
        if (trace == null) {
            return;
        }
        String span = TraceIds.raw(mdc.get("dd.span_id"));
        Map<String, String> dd = new LinkedHashMap<>();
        dd.put("trace_id", trace);
        if (span != null) {
            dd.put("span_id", span);
        }
        out.put("dd", dd);
        putIfPresent(out, "trace_id", TraceIds.traceId(trace));
        putIfPresent(out, "span_id", TraceIds.spanId(span));
    }

    private static void putContext(Map<String, Object> out, Map<String, String> mdc) {
        for (String key : ID_KEYS) {
            String value = mdc.get(key);
            if (value != null && ID.matcher(value).matches()) {
                out.put(key, value);
            }
        }
        String attempt = mdc.get("attempt");
        if (attempt != null && ATTEMPT.matcher(attempt).matches()) {
            int number = Integer.parseInt(attempt);
            if (number >= 1 && number <= 1_000_000) {
                out.put("attempt", number);
            }
        }
        String eventName = mdc.get("event_name");
        if (eventName != null && EVENT_NAMES.contains(eventName)) {
            out.put("event_name", eventName);
        }
    }

    private static void putIfPresent(Map<String, Object> out, String key, String value) {
        if (value != null) {
            out.put(key, value);
        }
    }

    private static void putRuntime(Map<String, String> out, String field, Environment environment, String key) {
        try {
            String value = environment.getProperty(key);
            if (value != null && META.matcher(value).matches()) {
                out.put(field, value);
            }
        } catch (IllegalArgumentException unresolvable) {
            // 해석 못 하는 자리표시자도 형식 오류와 같이 필드 생략 — 관측 설정이 기동을 막지 않는다.
        }
    }
}

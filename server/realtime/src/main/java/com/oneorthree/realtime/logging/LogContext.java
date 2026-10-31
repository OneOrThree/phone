package com.oneorthree.realtime.logging;

import org.slf4j.Logger;
import org.slf4j.MDC;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;

/**
 * 앱 로그 문맥(MDC) scope — 넣은 키의 <b>이전 값</b>을 기억했다가 {@link #close()} 에서 그 값으로 되돌린다(없었으면 지운다).
 *
 * <p>전체 {@code MDC.clear()} 를 하지 않고, tracer 소유 {@code dd.*}·{@code trace_id}·{@code span_id} 는 읽지도 쓰지도 않는다.
 * 값은 계약 §2.1 형식(ID {@code [A-Za-z0-9_.:-]{1,128}}, attempt 1..1000000)을 어기면 그 키만 버린다 — 관측 실패가 업무를
 * 실패시키지 않는다. 설치한 스레드에서 닫는다.
 */
public final class LogContext implements AutoCloseable {

    public static final String REQUEST_ID = "request_id";
    public static final String ORIGIN_REQUEST_ID = "origin_request_id";
    public static final String ORIGIN_TRACE_ID = "origin_trace_id";
    public static final String USER_ID = "user_id";
    public static final String EVENT_ID = "event_id";
    public static final String DELIVERY_ID = "delivery_id";
    public static final String ATTEMPT = "attempt";
    public static final String MESSAGE_ID = "message_id";
    public static final String EVENT_NAME = "event_name";
    /**
     * 내부 표식(값 {@code "1"}) — 입구가 받은 원인 문맥을 형식·버전 검사로 버렸다. 원래 없던 origin 과 구분해, 팬아웃 telemetry
     * 가 버린 문맥을 현재 {@code request_id} 로 다시 올리지 않게 한다. Data {@code OutboxOrigin} 과 같은 키이고, JSON allowlist
     * 밖이라 로그에 나가지 않는다.
     */
    public static final String ORIGIN_DROPPED = "origin_dropped";

    /** {@code event_name} 값(계약 §2.1 허용 목록 중 이 서비스가 쓰는 것). publish 는 «Pub/Sub 에 넘겼다»이지 «건너편이 받았다»가 아니다. */
    public static final String FANOUT_PUBLISH = "fanout.publish";
    public static final String FANOUT_RECEIVE = "fanout.receive";
    public static final String CONSUMER_ACCEPT = "consumer.accept";

    /**
     * 스레드를 건널 때 옮기는 키(설계 §2.2). {@code event_name} 은 로그 한 줄의 표지라 옮기지 않는다. {@code user_id} 도 옮기지
     * 않는다 — 아웃바운드 스레드의 «현재 사용자»는 수신 세션인데 발신자 id 가 붙으면 수신자별 판정 로그와 섞여 읽힌다. 연결은
     * {@code request_id}·{@code origin_*}·{@code event_id}/{@code message_id} 로 한다. {@link #ORIGIN_DROPPED} 도 옮긴다 —
     * telemetry 를 만드는 자리(이동 길잡이·재검사 스케줄러)가 작업 스레드에 있을 수 있다.
     */
    static final List<String> PROPAGATED = List.of(REQUEST_ID, ORIGIN_REQUEST_ID, EVENT_ID,
            ORIGIN_TRACE_ID, DELIVERY_ID, ATTEMPT, "operation_id", MESSAGE_ID, "edge_request_id", ORIGIN_DROPPED);

    // 들어오는 HTTP X-Request-Id 필터는 [A-Za-z0-9_-] 로 더 좁다. 서비스 간 origin 은 나가는 쪽 규칙(이 패턴)을 따른다 — 의도된 차이.
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_.:-]{1,128}");
    private static final int MAX_ATTEMPT = 1_000_000;

    /** 이 scope 가 건드린 키 → 건드리기 전 값(null = 없었다). */
    private final Map<String, String> previous = new HashMap<>();

    private LogContext() {
    }

    public static LogContext open() {
        return new LogContext();
    }

    /** 형식이 맞으면 설치한다. null·형식 오류는 그 키를 건드리지 않는다. */
    public LogContext put(String key, String value) {
        String safe = valid(key, value);
        if (safe != null) {
            remember(key);
            MDC.put(key, safe);
        }
        return this;
    }

    /** 이 scope 동안 그 키를 내려 둔다 — 닫으면 돌아온다. */
    public LogContext remove(String key) {
        remember(key);
        MDC.remove(key);
        return this;
    }

    private void remember(String key) {
        if (!previous.containsKey(key)) {
            previous.put(key, MDC.get(key));
        }
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

    /** 제출 스레드의 전달 키 스냅샷 — 작업 제출 시점에 부른다. */
    public static Map<String, String> capture() {
        Map<String, String> values = new HashMap<>();
        for (String key : PROPAGATED) {
            String value = MDC.get(key);
            if (value != null) {
                values.put(key, value);
            }
        }
        return Map.copyOf(values);
    }

    /**
     * 스냅샷을 «그대로» 설치한다 — 스냅샷에 없는 전달 키는 지워, 실행 스레드에 남은 값이 다른 작업에 붙지 않게 한다.
     * 닫으면 실행 스레드의 원래 값으로 돌아간다(중첩·CallerRuns 도 같다).
     */
    public static LogContext replace(Map<String, String> snapshot) {
        LogContext scope = new LogContext();
        for (String key : PROPAGATED) {
            String value = snapshot.get(key);
            if (value == null) {
                scope.remove(key);
            } else {
                scope.put(key, value);
            }
        }
        // 전달 대상은 아니지만 CallerRuns 처럼 제출 스레드에서 실행돼도 발신자 id 가 보이지 않게 내려 둔다.
        scope.remove(USER_ID);
        return scope;
    }

    /**
     * 지금 스레드의 전달 키를 작업에 실어 둔다 — 직접 만든 실행기(이동 길잡이·재검사 스케줄러)에 넘길 작업을 감싼다(GROMO-2581).
     * 실행 스레드에서는 {@link #replace} 로 설치하고 작업이 끝나면 되돌린다. 작업 안의 실패 로그도 이 문맥을 단다.
     */
    public static Runnable carrying(Runnable task) {
        Map<String, String> snapshot = capture();
        return () -> {
            try (LogContext scope = replace(snapshot)) {
                task.run();
            }
        };
    }

    /**
     * 내부 carrier(계약 §3, Kafka 헤더·내부 HTTP 헤더 공통 소문자 이름)를 설치한다. 버전 헤더가 없거나 빈 값이거나 {@code 1} 이면 읽고, 모르는
     * 버전은 통째로 무시한다. origin 헤더가 있었는데 하나도 받지 못했거나 모르는 버전이면 {@link #ORIGIN_DROPPED} 를 둔다.
     *
     * @param header 이름 → 값(없으면 null). HTTP 헤더 조회는 대소문자를 가리지 않는다
     */
    public static LogContext openCarrier(UnaryOperator<String> header) {
        LogContext scope = open();
        String version = header.apply("x-trace-context-version");
        boolean versionAllowed = isBlank(version) || "1".equals(version.strip());
        String originRequestId = header.apply("x-origin-request-id");
        String originTraceId = header.apply("x-origin-trace-id");
        if (versionAllowed) {
            scope.put(ORIGIN_REQUEST_ID, originRequestId)
                    .put(ORIGIN_TRACE_ID, originTraceId)
                    .put(EVENT_ID, header.apply("x-event-id"))
                    .put(DELIVERY_ID, header.apply("x-delivery-id"))
                    .put(ATTEMPT, header.apply("x-attempt"));
        }
        boolean adopted = versionAllowed
                && (valid(ORIGIN_REQUEST_ID, originRequestId) != null || valid(ORIGIN_TRACE_ID, originTraceId) != null);
        boolean sent = !isBlank(originRequestId) || !isBlank(originTraceId);
        if (!adopted && (sent || !versionAllowed)) {
            scope.put(ORIGIN_DROPPED, "1");
        }
        return scope;
    }

    /**
     * 인증을 통과한 내부 HTTP 요청 — carrier 에 더해, {@code X-Origin-*} 이 하나도 없고 carrier 버전이 허용될 때만 호출자의 {@code X-Request-Id} 를
     * 원인 요청 번호로 쓴다(계약 §3, Business 직접 호출 경로).
     */
    public static LogContext openInternalHttp(UnaryOperator<String> header) {
        LogContext scope = openCarrier(header);
        String version = header.apply("x-trace-context-version");
        boolean versionAllowed = isBlank(version) || "1".equals(version.strip());
        if (versionAllowed && isBlank(header.apply("x-origin-request-id"))
                && isBlank(header.apply("x-origin-trace-id"))) {
            scope.put(ORIGIN_REQUEST_ID, header.apply("x-request-id"));
        }
        return scope;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /** {@code event_name} 을 이 한 줄에만 달아 INFO 로 남긴다. */
    public static void info(Logger log, String eventName, String format, Object... args) {
        try (LogContext line = open().put(EVENT_NAME, eventName)) {
            log.info(format, args);
        }
    }

    /** 계약 §2.1 형식 검사 — 맞으면 값(앞뒤 공백 제거), 아니면 null. */
    public static String valid(String key, String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (ATTEMPT.equals(key)) {
            try {
                int attempt = Integer.parseInt(trimmed);
                return attempt >= 1 && attempt <= MAX_ATTEMPT ? Integer.toString(attempt) : null;
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return ID.matcher(trimmed).matches() ? trimmed : null;
    }
}

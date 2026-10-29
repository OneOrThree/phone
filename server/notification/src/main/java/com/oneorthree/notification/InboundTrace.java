package com.oneorthree.notification;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.header.Headers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * 수신 원인 문맥 (GROMO-2557, 로그 계약 §2·§3).
 *
 * <p>Data relay 가 Kafka 헤더·내부 HTTP 헤더로 실어 보낸 carrier 를 검사해 담고, 수신 처리 동안만 앱 MDC 에 설치한다.
 * 형식이 어긋난 칸은 그 칸만 버리고, 모르는 carrier 버전이면 통째로 버린다 — 관측 값 때문에 수신·트랜잭션·DLT 판정이
 * 바뀌지 않는다. 문맥은 봉투 본문이 아니라 헤더에서만 오므로 {@code envelope_hash} 대상도 그대로다.
 *
 * <p>{@code delivery_id}·{@code attempt} 는 헤더로 받은 <b>relay 의</b> 값이다(이 서비스의 {@code deliveries.id} 와 다르다).
 * 서비스 사이 연결 키는 {@code event_id} 다.
 *
 * <p>{@code X-Trace-Context-Version} 헤더가 없거나 비어 있고 origin 헤더만 있으면 v1 로 간주한다(의도). 앞뒤 공백은 걷어 내며,
 * 공백만 있는 헤더는 «없음»이라 세지 않는다 — Data {@code TraceIdFilter} 와 같은 규칙이다.
 *
 * <p>버린 carrier 는 값 없이 <b>헤더 이름만</b> {@value #DROPPED} 카운터(태그 {@code header})로 센다(GROMO-2582) —
 * 값은 신뢰할 수 없는 입력이라 로그·태그에 싣지 않고, 태그 값은 고정된 6개 이름뿐이라 카디널리티가 낮다.
 *
 * @param originRequestId 최초 원인 요청 ID
 * @param originTraceId   최초 원인 trace id 원문
 * @param deliveryId      relay 전달 행 id
 * @param attempt         relay 시도 번호
 */
record InboundTrace(String originRequestId, String originTraceId, String deliveryId, String attempt) {

    /** 형식이 어긋나 버린 carrier 헤더 수 — 태그 {@code header} 는 헤더 이름. */
    static final String DROPPED = "notification.inbound.carrier.dropped";
    static final InboundTrace NONE = new InboundTrace(null, null, null, null);

    private static final Logger LOG = LoggerFactory.getLogger(InboundTrace.class);
    /** 로그 계약 §2.1 의 ID 류 형식. */
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_.:-]{1,128}");
    private static final Pattern ATTEMPT = Pattern.compile("[1-9][0-9]{0,6}");
    private static final int MAX_ATTEMPT = 1_000_000;
    /** {@code deliveries.origin_trace_id} 열 길이 — 넘는 값을 넣으면 INSERT 가 깨져 수신이 DLT 로 간다. */
    private static final int MAX_TRACE_LENGTH = 64;

    /**
     * @param headers Kafka 레코드 헤더 — 이름은 소문자(§3)
     * @param metrics 버린 carrier 를 세는 레지스트리
     * @return 검사를 통과한 문맥
     */
    static InboundTrace fromKafka(Headers headers, MeterRegistry metrics) {
        return read(name -> {
            Header header = headers.lastHeader(name.toLowerCase(Locale.ROOT));
            return header == null || header.value() == null
                    ? null : new String(header.value(), StandardCharsets.UTF_8);
        }, metrics);
    }

    /**
     * 서비스 인증({@link ServiceAuth})을 통과한 내부 요청의 헤더에서 읽는다. origin 헤더가 없고 {@code X-Request-Id} 가
     * 유효하면 그 요청 번호를 origin 으로 삼는다(직접 호출 경로, §3). origin 헤더가 하나라도 있으면(깨졌어도) 이 대체는
     * 돌지 않으므로 그때의 깨진 {@code X-Request-Id} 는 세지 않는다.
     *
     * @param request 인증을 통과한 요청
     * @param metrics 버린 carrier 를 세는 레지스트리
     * @return 검사를 통과한 문맥
     */
    static InboundTrace fromHttp(HttpServletRequest request, MeterRegistry metrics) {
        InboundTrace trace = read(request::getHeader, metrics);
        if (trace.originRequestId == null && trace.originTraceId == null) {
            String requestId = checked(metrics, "X-Request-Id", request.getHeader("X-Request-Id"), false);
            if (requestId != null) {
                return new InboundTrace(requestId, null, trace.deliveryId, trace.attempt);
            }
        }
        return trace;
    }

    private static InboundTrace read(Function<String, String> header, MeterRegistry metrics) {
        String version = strip(header.apply("X-Trace-Context-Version"));
        if (version != null && !"1".equals(version)) {
            drop(metrics, "X-Trace-Context-Version");
            return NONE;
        }
        String attempt = strip(header.apply("X-Attempt"));
        return new InboundTrace(checked(metrics, "X-Origin-Request-Id", header.apply("X-Origin-Request-Id"), false),
                checked(metrics, "X-Origin-Trace-Id", header.apply("X-Origin-Trace-Id"), true),
                checked(metrics, "X-Delivery-Id", header.apply("X-Delivery-Id"), false),
                attempt == null || ATTEMPT.matcher(attempt).matches() && Integer.parseInt(attempt) <= MAX_ATTEMPT
                        ? attempt : drop(metrics, "X-Attempt"));
    }

    /** 값이 있는데 형식 검사를 통과하지 못하면 헤더 이름만 센다. */
    private static String checked(MeterRegistry metrics, String name, String value, boolean trace) {
        String raw = strip(value);
        String safe = trace ? safeTrace(raw) : safeId(raw);
        return raw != null && safe == null ? drop(metrics, name) : safe;
    }

    /** 앞뒤 공백을 걷어 내고, 비었으면 «없음»({@code null}) — 빈 헤더는 버린 carrier 로 세지 않는다. */
    private static String strip(String raw) {
        String stripped = raw == null ? null : raw.strip();
        return stripped == null || stripped.isEmpty() ? null : stripped;
    }

    private static String drop(MeterRegistry metrics, String name) {
        metrics.counter(DROPPED, "header", name).increment();
        return null;
    }

    /** 형식 규칙 한 곳 — 발송 쪽 {@code DispatchService.Cause} 도 DB 값을 MDC 에 넣기 전에 여기를 거친다. */
    static String safeId(Object value) {
        return value != null && SAFE_ID.matcher(value.toString()).matches() ? value.toString() : null;
    }

    /** @return {@link #safeId} 를 통과하고 열 길이(64)를 넘지 않는 trace 원문, 아니면 {@code null} */
    static String safeTrace(Object value) {
        String id = safeId(value);
        return id != null && id.length() <= MAX_TRACE_LENGTH ? id : null;
    }

    /**
     * 이 문맥을 설치한 채 수신하고, 커밋이 끝난 뒤 결과 한 줄을 남긴다. 설치한 키는 끝나면 이전 값으로 돌아간다.
     *
     * @param inbound 수신 서비스 — 트랜잭션 프록시라 반환 시점에 커밋이 끝나 있다
     * @param body    봉투
     * @param source  {@code kafka}·{@code http}
     * @return 기존 응답 본문 그대로
     */
    Map<String, Object> accept(InboundService inbound, Map<String, Object> body, String source) {
        Object eventId = body.get("eventId");
        try (Scope ignored = new Scope()
                .set("event_id", eventId instanceof String id ? safeId(id) : null)
                .set("origin_request_id", originRequestId)
                .set("origin_trace_id", originTraceId)
                .set("delivery_id", deliveryId)
                .set("attempt", attempt)) {
            boolean applied;
            try {
                applied = inbound.receive(body, this);
            } catch (NotificationFailure failure) {
                if (failure.status() == 409) {
                    logResult("conflict", source);
                }
                throw failure;
            }
            if (applied) {
                logResult("accepted", source);
            } else {
                logDuplicate(inbound, eventId, source);
            }
            return InboundService.ACCEPTED;
        }
    }

    /**
     * 재전달은 헤더가 달라도 기존 행을 건드리지 않으므로, 로그도 처음 수신 때 적은 origin 으로 남긴다(GROMO-2582).
     * 발송 작업 행이 있으면 그 값이 헤더 값을 대신하고(null 이면 키를 뺀다), 없으면 헤더 값 그대로다. 조회 실패는 로그만 잃는다.
     */
    private static void logDuplicate(InboundService inbound, Object eventId, String source) {
        try (Scope scope = new Scope()) {
            Map<String, Object> first = null;
            try {
                first = eventId instanceof String id ? inbound.firstOrigin(id) : null;
            } catch (RuntimeException lookupFailure) {
                // 조회 실패는 헤더 값 그대로 남긴다.
            }
            if (first != null) {
                scope.set("origin_request_id", safeId(first.get("origin_request_id")))
                        .set("origin_trace_id", safeTrace(first.get("origin_trace_id")));
            }
            logResult("duplicate", source);
        }
    }

    /** 본문·토큰은 싣지 않는다 — 사건은 MDC 의 event_id 로 찾는다. */
    private static void logResult(String result, String source) {
        try (Scope ignored = new Scope().set("event_name", "consumer.accept")) {
            LOG.info("알림 수신 처리 결과 result={} source={}", result, source);
        }
    }

    /**
     * 자기가 넣은 키만 이전 값으로 되돌린다. 전체 MDC 를 지우지 않는다(§2.2). data-api {@code LogScope} 와 같은 규칙의 복사본이다
     * (서비스 간 공유 코드 없음) — 규칙을 바꾸면 양쪽을 함께 고친다.
     */
    static final class Scope implements AutoCloseable {
        private final Map<String, String> previous = new LinkedHashMap<>();

        Scope set(String key, String value) {
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
}

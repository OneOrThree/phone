package com.oneorthree.phone.outbox.client;

import com.oneorthree.phone.common.logging.LogScope;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 한 전달 시도의 원인 문맥 carrier (GROMO-2557, 로그 계약 §3).
 *
 * <p>relay 가 시도마다 한 번 만들어 <b>로그 scope 와 송신 헤더에 같은 값</b>을 쓴다. 봉투 본문·Kafka key·토픽·HTTP
 * 경로에는 넣지 않는다 — 헤더로만 나간다. 값이 없거나 §2.1 형식이 아닌 칸은 헤더를 싣지 않는다.
 *
 * @param eventId         봉투의 결정적 사건 키 — 서비스 사이 연결 키
 * @param deliveryId      이 서비스의 전달 행 id
 * @param attempt         이 전달 행의 현재 시도 번호(선점이 올린 값, 첫 시도 1)
 * @param originRequestId 최초 원인 요청 ID
 * @param originTraceId   최초 원인 trace id 원문
 */
public record OutboxCarrier(String eventId, UUID deliveryId, int attempt, String originRequestId,
        String originTraceId) {

    /** carrier 형식 버전 — 수신 측은 모르는 버전이면 origin·전달 헤더를 통째로 무시한다. */
    public static final String VERSION = "1";

    /**
     * @param delivery 선점한 전달 행
     * @param envelope 그 봉투 — 없으면({@code null}) 전달 행 값만 싣는다
     * @return 이번 시도의 carrier
     */
    public static OutboxCarrier of(EventOutboxDelivery delivery, EventOutbox envelope) {
        return envelope == null
                ? new OutboxCarrier(null, delivery.getId(), delivery.getAttemptCount(), null, null)
                : new OutboxCarrier(envelope.getEventId(), delivery.getId(), delivery.getAttemptCount(),
                        envelope.getOriginRequestId(), envelope.getOriginTraceId());
    }

    /**
     * 이번 시도의 앱 MDC scope 를 연다 — 닫으면 이 키들만 이전 값으로 돌아간다.
     *
     * @return 설치한 scope
     */
    public LogScope openScope() {
        return LogScope.open()
                .id("event_id", eventId)
                .id("delivery_id", deliveryId)
                .attempt(attempt)
                .id("origin_request_id", originRequestId)
                .id("origin_trace_id", originTraceId);
    }

    /**
     * HTTP 헤더 이름(대소문자 그대로)과 값. Kafka 는 같은 이름의 소문자를 쓴다(§3).
     *
     * @return 실을 헤더 — 순서 고정
     */
    public Map<String, String> headers() {
        Map<String, String> headers = new LinkedHashMap<>();
        putIfSafe(headers, "X-Origin-Request-Id", originRequestId);
        putIfSafe(headers, "X-Origin-Trace-Id", originTraceId);
        putIfSafe(headers, "X-Event-Id", eventId);
        putIfSafe(headers, "X-Delivery-Id", deliveryId == null ? null : deliveryId.toString());
        if (attempt >= 1) {
            headers.put("X-Attempt", Integer.toString(attempt));
        }
        headers.put("X-Trace-Context-Version", VERSION);
        return headers;
    }

    private static void putIfSafe(Map<String, String> headers, String name, String value) {
        String safe = LogScope.safeId(value);
        if (safe != null) {
            headers.put(name, safe);
        }
    }
}

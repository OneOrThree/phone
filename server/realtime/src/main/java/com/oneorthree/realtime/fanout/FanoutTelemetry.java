package com.oneorthree.realtime.fanout;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.realtime.logging.LogContext;
import org.slf4j.MDC;

/**
 * Redis 내부 wire({@code chat:fanout}·{@code chat:events:v1})에 얹는 관측 메타데이터 v1 — 받는 인스턴스가 원인 요청의 로그에
 * 이어 붙인다(계약 §3). <b>클라이언트로 나가는 DTO 에는 싣지 않는다.</b> 채팅은 {@code message.messageId} 가 이미 연결 키라
 * {@code eventId} 를 비운다.
 *
 * <p>{@code v} 는 boxed 다 — primitive 면 이 필드가 없는 JSON 을 {@code FAIL_ON_NULL_FOR_PRIMITIVES} 가 거절해 구독자가
 * 그 건을 조용히 버린다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FanoutTelemetry(Integer v, String originRequestId, String originTraceId, String eventId) {

    static final int VERSION = 1;

    /**
     * 발행 직전 현재 스레드 MDC 에서 만든다. 원인(origin)이 이미 있으면 그대로 싣고, 없을 때만 지금 {@code request_id} 를 원인으로
     * 승격한다(계약 §2.2). 담을 값이 하나도 없으면 null — wire 에서 빠진다.
     */
    public static FanoutTelemetry capture(String eventId) {
        String originRequestId = LogContext.valid(LogContext.ORIGIN_REQUEST_ID, MDC.get(LogContext.ORIGIN_REQUEST_ID));
        String originTraceId = LogContext.valid(LogContext.ORIGIN_TRACE_ID, MDC.get(LogContext.ORIGIN_TRACE_ID));
        if (originRequestId == null && originTraceId == null) {
            originRequestId = LogContext.valid(LogContext.REQUEST_ID, MDC.get(LogContext.REQUEST_ID));
        }
        String event = LogContext.valid(LogContext.EVENT_ID, eventId);
        if (originRequestId == null && originTraceId == null && event == null) {
            return null;
        }
        return new FanoutTelemetry(VERSION, originRequestId, originTraceId, event);
    }

    /** 받는 쪽 — v1 의 값만 설치한다. 없거나 모르는 버전이면 빈 scope(무시)다. */
    public static LogContext install(FanoutTelemetry telemetry) {
        LogContext scope = LogContext.open();
        if (telemetry != null && telemetry.v() != null && telemetry.v() == VERSION) {
            scope.put(LogContext.ORIGIN_REQUEST_ID, telemetry.originRequestId())
                    .put(LogContext.ORIGIN_TRACE_ID, telemetry.originTraceId())
                    .put(LogContext.EVENT_ID, telemetry.eventId());
        }
        return scope;
    }
}

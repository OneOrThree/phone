package com.oneorthree.realtime.event;

import com.oneorthree.realtime.logging.LogContext;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;

/**
 * 두 입구(HTTP·Kafka) 공통 — 봉투의 eventId 를 입구 scope 에 얹고 처리 결과를 {@code consumer.accept} 한 줄로 남긴다(GROMO-2559).
 *
 * <p>처리는 {@link InboundEventService#accept} 그대로다(트랜잭션 프록시를 거친다). 줄은 반환 «뒤»라 accepted 는 커밋된 뒤다.
 * 실패는 결과 줄만 남기고 같은 예외를 그대로 올린다 — HTTP 400/500·Kafka 재시도·DLT 판정은 바뀌지 않는다.
 */
@Slf4j
public final class InboundAcceptLog {

    private InboundAcceptLog() {
    }

    public static boolean accept(InboundEventService inbound, JsonNode envelope, LogContext scope) {
        JsonNode eventId = envelope == null ? null : envelope.get("eventId");
        // 본문 eventId 가 정본이다(중복 판정 키). 헤더 x-event-id 는 본문을 못 읽을 때의 보조다.
        scope.put(LogContext.EVENT_ID, eventId != null && eventId.isString() ? eventId.stringValue() : null);
        try {
            boolean applied = inbound.accept(envelope);
            LogContext.info(log, LogContext.CONSUMER_ACCEPT, "사건 수신 — result={}", applied ? "accepted" : "duplicate");
            return applied;
        } catch (RuntimeException e) {
            LogContext.info(log, LogContext.CONSUMER_ACCEPT, "사건 수신 — result=failed reason={}",
                    e.getClass().getSimpleName());
            throw e;
        }
    }
}

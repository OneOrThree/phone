package com.oneorthree.realtime.fanout;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.realtime.logging.LogContext;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.annotation.JsonDeserialize;

import java.util.stream.Stream;

/**
 * Redis 내부 wire({@code chat:fanout}·{@code chat:events:v1})에 얹는 관측 메타데이터 v1 — 받는 인스턴스가 원인 요청의 로그에
 * 이어 붙인다(계약 §3). <b>클라이언트로 나가는 DTO 에는 싣지 않는다.</b> 채팅은 {@code message.messageId} 가 이미 연결 키라
 * {@code eventId} 를 비운다.
 *
 * <p>{@code v} 는 boxed 다 — primitive 면 이 필드가 없는 JSON 을 {@code FAIL_ON_NULL_FOR_PRIMITIVES} 가 거절해 구독자가
 * 그 건을 조용히 버린다.
 *
 * <p>받을 때는 {@link Lenient} 로 따로 읽는다 — 모양이 깨진 메타데이터는 null 로 버리고 업무 봉투는 그대로 전달한다(계약 §0).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonDeserialize(using = FanoutTelemetry.Lenient.class)
public record FanoutTelemetry(Integer v, String originRequestId, String originTraceId, String eventId) {

    static final int VERSION = 1;

    /**
     * 발행 직전 현재 스레드 MDC 에서 만든다. 원인(origin)이 이미 있으면 그대로 싣고, 없을 때만 지금 {@code request_id} 를 원인으로
     * 승격한다(계약 §2.2). 단 입구가 받은 origin 을 버렸다는 {@link LogContext#ORIGIN_DROPPED} 표식이 있으면 올리지 않는다 — 버린
     * 문맥이 현재 호출의 ID 로 바뀌지 않게. 담을 값이 하나도 없으면 null — wire 에서 빠진다.
     */
    public static FanoutTelemetry capture(String eventId) {
        String originRequestId = LogContext.valid(LogContext.ORIGIN_REQUEST_ID, MDC.get(LogContext.ORIGIN_REQUEST_ID));
        String originTraceId = LogContext.valid(LogContext.ORIGIN_TRACE_ID, MDC.get(LogContext.ORIGIN_TRACE_ID));
        if (originRequestId == null && originTraceId == null && MDC.get(LogContext.ORIGIN_DROPPED) == null) {
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

    /**
     * 손상된 메타데이터를 무시하는 역직렬화기. 기본 record 변환은 {@code "v":"x"}·객체 id 같은 타입 불일치에서 던지고, 구독자는 그것을
     * 봉투 전체의 실패로 보고 채팅·섬 사건·세션 폐기까지 버린다. 여기서는 트리로 읽어 객체가 아니거나 한 필드라도 타입이 어긋나면
     * <b>통째로</b> null 이다 — 깨진 발행자가 낸 나머지 값도 원인으로 믿지 않는다. 모르는 키는 무시한다(다음 버전 호환).
     */
    @Slf4j
    static final class Lenient extends ValueDeserializer<FanoutTelemetry> {

        @Override
        public FanoutTelemetry deserialize(JsonParser p, DeserializationContext ctxt) {
            JsonNode node = ctxt.readTree(p);
            JsonNode v = node.path("v");
            if (node.isObject() && (absent(v) || v.isInt())
                    && Stream.of("originRequestId", "originTraceId", "eventId")
                            .map(node::path).allMatch(id -> absent(id) || id.isString())) {
                return new FanoutTelemetry(v.isInt() ? v.intValue() : null, text(node, "originRequestId"),
                        text(node, "originTraceId"), text(node, "eventId"));
            }
            // 값 원문은 남기지 않는다 — 모양만.
            log.debug("팬아웃 telemetry 형식 불일치 — 메타데이터만 버린다. nodeType={}", node.getNodeType());
            return null;
        }

        private static boolean absent(JsonNode node) {
            return node.isMissingNode() || node.isNull();
        }

        private static String text(JsonNode node, String field) {
            JsonNode value = node.path(field);
            return value.isString() ? value.stringValue() : null;
        }
    }
}

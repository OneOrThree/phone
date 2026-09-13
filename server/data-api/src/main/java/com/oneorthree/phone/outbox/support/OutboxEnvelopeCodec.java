package com.oneorthree.phone.outbox.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.oneorthree.phone.outbox.dto.EventEnvelope;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 봉투 ↔ JSON 변환 — 저장(jsonb)·발행(Kafka value)·HTTP 본문이 같은 모양을 쓰게 만든다.
 *
 * <p>주입 없는 순수 변환이라 {@code support/} 다(규약 §2). 스프링 컨텍스트 없이 단위 테스트할 수 있다.
 *
 * <p><b>시각은 ISO-8601 문자열이다.</b> 기본 Jackson 은 {@code Instant} 를 epoch 초 실수로 쓰는데,
 * 그러면 소비자(알림 서버·링크 서버)가 언어마다 다른 부동소수 파싱에 걸리고 계약 문서
 * ({@code docs/contracts/notification-event-v1.json})와도 어긋난다.
 *
 * <p><b>{@code null} 필드를 지우지 않는다.</b> {@code scheduledAt}·{@code locale}·{@code subjectId} 의
 * 「없음」은 의미가 있는 값이라(예약 아님 · 로케일 미보고 · 대상 없음), 키를 빼면 소비자가 「필드가
 * 아직 없는 구 스키마」와 구분할 수 없다.
 */
public final class OutboxEnvelopeCodec {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private OutboxEnvelopeCodec() {
    }

    /**
     * 봉투를 저장·발행용 맵으로 편다.
     *
     * @param envelope 정본 봉투
     * @return 정본 필드 순서를 유지한 맵 — 그대로 jsonb 에 넣거나 JSON 으로 직렬화한다
     */
    public static Map<String, Object> toMap(EventEnvelope envelope) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("eventId", envelope.eventId());
        map.put("schemaVersion", envelope.schemaVersion());
        map.put("type", envelope.type());
        map.put("occurredAt", envelope.occurredAt() == null ? null : envelope.occurredAt().toString());
        map.put("scheduledAt", envelope.scheduledAt() == null ? null : envelope.scheduledAt().toString());
        map.put("userId", envelope.userId() == null ? null : envelope.userId().toString());
        map.put("locale", envelope.locale());
        map.put("subjectId", envelope.subjectId());
        map.put("version", envelope.version());
        map.put("params", envelope.params());
        return map;
    }

    /**
     * 발행용 JSON 문자열.
     *
     * @param value 봉투 맵 또는 대상별 명령 본문
     * @return JSON 문자열
     * @throws IllegalStateException 직렬화 불가 — 저장 시점에 이미 jsonb 로 들어간 값이라 정상 흐름에선
     *     발생하지 않는다
     */
    public static String toJson(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("outbox payload 직렬화 실패", e);
        }
    }

    /**
     * 저장된 응답을 되살린다 — 멱등 재생이 쓴다.
     *
     * @param json JSON 문자열
     * @param type 되살릴 타입
     * @param <T>  되살릴 타입
     * @return 되살린 값
     * @throws JsonProcessingException 저장된 응답이 요청 타입과 맞지 않을 때 — 호출부가 도메인 오류로
     *     바꾼다
     */
    public static <T> T fromJson(String json, Class<T> type) throws JsonProcessingException {
        return MAPPER.readValue(json, type);
    }
}

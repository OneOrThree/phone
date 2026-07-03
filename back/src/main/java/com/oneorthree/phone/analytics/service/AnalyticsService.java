package com.oneorthree.phone.analytics.service;

import com.oneorthree.phone.analytics.domain.ClientActivityEvent;
import com.oneorthree.phone.analytics.exception.AnalyticsErrorCode;
import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 클라 이벤트를 화이트리스트 검증 후 Track 2 로그 스트림에 source=client 로 합류시킨다.
 * user_id 는 JwtFilter→TraceIdFilter 가 심은 MDC 로 자동 확보(서버 이벤트와 조인 가능).
 */
@Service
@RequiredArgsConstructor
public class AnalyticsService {

    // GA4 이벤트 파라미터 한도와 정합 — 초과는 INVALID_PAYLOAD(400)
    private static final int MAX_PAYLOAD_KEYS = 25;
    // DoS 방지: 키·문자열 값 길이 무제한 허용 시 로그 플러딩 벡터 발생 — 각각 상한 설정
    private static final int MAX_KEY_LENGTH = 40;
    private static final int MAX_STRING_VALUE_LENGTH = 500;

    private final UserActivityEventLogger userActivityEventLogger;

    /**
     * 이벤트 화이트리스트(ClientActivityEvent)·payload 크기·스칼라 값 검증 후 발행.
     * payload 키 스키마까지 강제하지 않음 — FE 계약(스펙 확정).
     */
    public void record(String event, Map<String, Object> payload) {
        ClientActivityEvent clientEvent = ClientActivityEvent.from(event)
                .orElseThrow(() -> new AnalyticsException(AnalyticsErrorCode.UNSUPPORTED_EVENT));
        Map<String, Object> safePayload = payload == null ? Map.of() : payload;
        validatePayload(safePayload);
        userActivityEventLogger.logClient(clientEvent, safePayload);
    }

    /** payload 가드: 최대 25키, 키 길이 ≤40자, 값은 스칼라(String·Number·Boolean·null)만·String 길이 ≤500자 — 중첩 객체·배열 거부. */
    private void validatePayload(Map<String, Object> payload) {
        if (payload.size() > MAX_PAYLOAD_KEYS) {
            throw new AnalyticsException(AnalyticsErrorCode.INVALID_PAYLOAD);
        }
        // DoS 방지: 키 길이 초과 거부
        boolean hasLongKey = payload.keySet().stream()
                .anyMatch(key -> key.length() > MAX_KEY_LENGTH);
        if (hasLongKey) {
            throw new AnalyticsException(AnalyticsErrorCode.INVALID_PAYLOAD);
        }
        for (Object value : payload.values()) {
            if (value == null) {
                continue;
            }
            if (!(value instanceof String) && !(value instanceof Number) && !(value instanceof Boolean)) {
                // 중첩 객체·배열 거부
                throw new AnalyticsException(AnalyticsErrorCode.INVALID_PAYLOAD);
            }
            // DoS 방지: String 값 길이 초과 거부
            if (value instanceof String stringValue && stringValue.length() > MAX_STRING_VALUE_LENGTH) {
                throw new AnalyticsException(AnalyticsErrorCode.INVALID_PAYLOAD);
            }
        }
    }
}

package com.oneorthree.phone.analytics.service;

import com.oneorthree.phone.analytics.domain.ClientActivityEvent;
import com.oneorthree.phone.analytics.exception.AnalyticsErrorCode;
import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * AnalyticsService 단위 테스트.
 *
 * <p>핵심 검증: (1) 화이트리스트(ClientActivityEvent) 통과 이벤트만 source=client 로 발행,
 * (2) 미등록 이벤트 → UNSUPPORTED_EVENT, (3) payload 크기(≤25키)·스칼라 값 가드.
 */
@ExtendWith(MockitoExtension.class)
class AnalyticsServiceTest {

    @InjectMocks
    private AnalyticsService analyticsService;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    // ── 화이트리스트 통과 ──────────────────────────────────────────────────

    @Test
    @DisplayName("화이트리스트 이벤트(focus_session_started) → logClient 에 event·payload 그대로 전달")
    void recordWhitelistedEventDelegatesToLogClient() {
        Map<String, Object> payload = Map.of("has_tag", true, "goal_minutes", 60);

        analyticsService.record("focus_session_started", payload);

        verify(userActivityEventLogger)
                .logClient(ClientActivityEvent.FOCUS_SESSION_STARTED, payload);
    }

    @Test
    @DisplayName("화이트리스트 이벤트(focus_session_abandoned) → logClient 발행")
    void recordAbandonedEventDelegatesToLogClient() {
        Map<String, Object> payload = Map.of("elapsed_seconds", 120, "reason", "app_switch");

        analyticsService.record("focus_session_abandoned", payload);

        verify(userActivityEventLogger)
                .logClient(ClientActivityEvent.FOCUS_SESSION_ABANDONED, payload);
    }

    @Test
    @DisplayName("payload null → 빈 Map 으로 위임(NPE 없이 발행)")
    void recordNullPayloadDelegatesEmptyMap() {
        analyticsService.record("focus_session_started", null);

        verify(userActivityEventLogger)
                .logClient(ClientActivityEvent.FOCUS_SESSION_STARTED, Map.of());
    }

    @Test
    @DisplayName("payload 25키(경계값) → 정상 발행")
    void recordPayloadAtMaxKeysSucceeds() {
        Map<String, Object> payload = new HashMap<>();
        for (int i = 0; i < 25; i++) {
            payload.put("key_" + i, i);
        }

        analyticsService.record("focus_session_started", payload);

        verify(userActivityEventLogger)
                .logClient(ClientActivityEvent.FOCUS_SESSION_STARTED, payload);
    }

    // ── 검증 실패 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("미등록 이벤트 문자열 → AnalyticsException(UNSUPPORTED_EVENT), 미발행")
    void recordUnknownEventThrowsUnsupportedEvent() {
        assertThatThrownBy(() -> analyticsService.record("screen_view", Map.of()))
                .isInstanceOf(AnalyticsException.class)
                .extracting("errorCode")
                .isEqualTo(AnalyticsErrorCode.UNSUPPORTED_EVENT);
        verify(userActivityEventLogger, never()).logClient(any(), any());
    }

    @Test
    @DisplayName("payload 26키(25 초과) → AnalyticsException(INVALID_PAYLOAD), 미발행")
    void recordPayloadOverMaxKeysThrowsInvalidPayload() {
        Map<String, Object> payload = new HashMap<>();
        for (int i = 0; i < 26; i++) {
            payload.put("key_" + i, i);
        }

        assertThatThrownBy(() -> analyticsService.record("focus_session_started", payload))
                .isInstanceOf(AnalyticsException.class)
                .extracting("errorCode")
                .isEqualTo(AnalyticsErrorCode.INVALID_PAYLOAD);
        verify(userActivityEventLogger, never()).logClient(any(), any());
    }

    @Test
    @DisplayName("payload 값에 중첩 객체(Map) → AnalyticsException(INVALID_PAYLOAD)")
    void recordNestedMapValueThrowsInvalidPayload() {
        Map<String, Object> payload = Map.of("nested", Map.of("inner", 1));

        assertThatThrownBy(() -> analyticsService.record("focus_session_started", payload))
                .isInstanceOf(AnalyticsException.class)
                .extracting("errorCode")
                .isEqualTo(AnalyticsErrorCode.INVALID_PAYLOAD);
        verify(userActivityEventLogger, never()).logClient(any(), any());
    }

    @Test
    @DisplayName("payload 값에 배열(List) → AnalyticsException(INVALID_PAYLOAD)")
    void recordListValueThrowsInvalidPayload() {
        Map<String, Object> payload = Map.of("tags", List.of("a", "b"));

        assertThatThrownBy(() -> analyticsService.record("focus_session_started", payload))
                .isInstanceOf(AnalyticsException.class)
                .extracting("errorCode")
                .isEqualTo(AnalyticsErrorCode.INVALID_PAYLOAD);
        verify(userActivityEventLogger, never()).logClient(any(), any());
    }

    @Test
    @DisplayName("payload 키 길이 41자(40 초과) → AnalyticsException(INVALID_PAYLOAD), 미발행 — DoS 방지")
    void recordPayloadKeyExceedsMaxLengthThrowsInvalidPayload() {
        // 41자 키: 길이 초과 → 거부
        String longKey = "k".repeat(41);
        Map<String, Object> payload = Map.of(longKey, "value");

        assertThatThrownBy(() -> analyticsService.record("focus_session_started", payload))
                .isInstanceOf(AnalyticsException.class)
                .extracting("errorCode")
                .isEqualTo(AnalyticsErrorCode.INVALID_PAYLOAD);
        verify(userActivityEventLogger, never()).logClient(any(), any());
    }

    @Test
    @DisplayName("payload String 값 길이 501자(500 초과) → AnalyticsException(INVALID_PAYLOAD), 미발행 — DoS 방지")
    void recordPayloadStringValueExceedsMaxLengthThrowsInvalidPayload() {
        // 501자 문자열 값: 길이 초과 → 거부
        String longValue = "v".repeat(501);
        Map<String, Object> payload = Map.of("key", longValue);

        assertThatThrownBy(() -> analyticsService.record("focus_session_started", payload))
                .isInstanceOf(AnalyticsException.class)
                .extracting("errorCode")
                .isEqualTo(AnalyticsErrorCode.INVALID_PAYLOAD);
        verify(userActivityEventLogger, never()).logClient(any(), any());
    }
}

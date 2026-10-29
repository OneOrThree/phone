package com.oneorthree.realtime.logging;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 키별 복원·형식 검사·스냅샷 치환·carrier 해석 (GROMO-2559, 계약 §2·§3). */
class LogContextTest {

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    @Test
    @DisplayName("닫으면 넣은 키만 이전 값으로 돌아간다 — 없던 키는 지우고 남의 키(dd.*)는 건드리지 않는다")
    void closeRestoresOnlyOwnKeys() {
        MDC.put(LogContext.REQUEST_ID, "outer");
        MDC.put("dd.trace_id", "123");

        try (LogContext scope = LogContext.open().put(LogContext.REQUEST_ID, "inner")
                .put(LogContext.EVENT_ID, "evt-1")) {
            assertThat(MDC.get(LogContext.REQUEST_ID)).isEqualTo("inner");
            try (LogContext nested = LogContext.open().put(LogContext.EVENT_ID, "evt-2")) {
                assertThat(MDC.get(LogContext.EVENT_ID)).isEqualTo("evt-2");
            }
            assertThat(MDC.get(LogContext.EVENT_ID)).isEqualTo("evt-1");
            scope.put(LogContext.EVENT_ID, "evt-3"); // 같은 키를 다시 넣어도 이전 값은 처음 것
        }

        assertThat(MDC.get(LogContext.REQUEST_ID)).isEqualTo("outer");
        assertThat(MDC.get(LogContext.EVENT_ID)).isNull();
        assertThat(MDC.get("dd.trace_id")).isEqualTo("123");
    }

    @Test
    @DisplayName("형식이 틀린 값은 그 키만 버린다 — ID 128자·허용 문자, attempt 1..1000000")
    void invalidValuesAreDroppedPerKey() {
        try (LogContext scope = LogContext.open()
                .put(LogContext.ORIGIN_REQUEST_ID, "a b")
                .put(LogContext.EVENT_ID, "user.withdrawn:1f0e-x")
                .put(LogContext.DELIVERY_ID, "x".repeat(129))
                .put(LogContext.ATTEMPT, "0")) {
            assertThat(MDC.get(LogContext.ORIGIN_REQUEST_ID)).isNull();
            assertThat(MDC.get(LogContext.EVENT_ID)).isEqualTo("user.withdrawn:1f0e-x");
            assertThat(MDC.get(LogContext.DELIVERY_ID)).isNull();
            assertThat(MDC.get(LogContext.ATTEMPT)).isNull();
        }
        assertThat(LogContext.valid(LogContext.ATTEMPT, " 2 ")).isEqualTo("2");
        assertThat(LogContext.valid(LogContext.ATTEMPT, "1000001")).isNull();
        assertThat(LogContext.valid(LogContext.ATTEMPT, "x")).isNull();
        assertThat(LogContext.valid(LogContext.REQUEST_ID, "x".repeat(128))).hasSize(128);
    }

    @Test
    @DisplayName("스냅샷 치환은 스냅샷 키를 그대로 깔고(없는 전달 키는 지운다) 닫으면 실행 스레드 값으로 돌아간다")
    void replaceInstallsExactlyTheSnapshot() {
        MDC.put(LogContext.EVENT_ID, "stale");
        MDC.put(LogContext.USER_ID, "worker-own");
        MDC.put("dd.span_id", "9");

        try (LogContext scope = LogContext.replace(Map.of(LogContext.MESSAGE_ID, "m-1"))) {
            assertThat(MDC.get(LogContext.MESSAGE_ID)).isEqualTo("m-1");
            assertThat(MDC.get(LogContext.EVENT_ID)).as("남은 값이 다른 작업에 붙지 않는다").isNull();
            assertThat(MDC.get(LogContext.USER_ID)).isNull();
            assertThat(MDC.get("dd.span_id")).as("tracer 소유는 손대지 않는다").isEqualTo("9");
        }

        assertThat(MDC.get(LogContext.EVENT_ID)).isEqualTo("stale");
        assertThat(MDC.get(LogContext.USER_ID)).isEqualTo("worker-own");
        assertThat(MDC.get(LogContext.MESSAGE_ID)).isNull();
    }

    @Test
    @DisplayName("스냅샷은 전달 키만 담는다 — dd.*·trace_id·span_id·event_name 은 옮기지 않는다")
    void captureCopiesOnlyPropagatedKeys() {
        MDC.put(LogContext.REQUEST_ID, "r-1");
        MDC.put(LogContext.EVENT_NAME, LogContext.FANOUT_RECEIVE);
        MDC.put("dd.trace_id", "1");
        MDC.put("trace_id", "legacy");
        MDC.put("span_id", "2");

        assertThat(LogContext.capture()).containsExactly(Map.entry(LogContext.REQUEST_ID, "r-1"));
    }

    @Test
    @DisplayName("carrier — 버전 1·없음은 읽고 모르는 버전은 통째로 무시, 내부 HTTP 는 X-Origin-* 이 없을 때만 X-Request-Id 를 원인으로")
    void carrierVersionsAndRequestIdFallback() {
        Map<String, String> v1 = Map.of("x-origin-request-id", "o-1", "x-event-id", "e-1", "x-delivery-id", "d-1",
                "x-attempt", "3", "x-trace-context-version", "1", "x-request-id", "biz-1");
        try (LogContext scope = LogContext.openInternalHttp(v1::get)) {
            assertThat(MDC.get(LogContext.ORIGIN_REQUEST_ID)).isEqualTo("o-1");
            assertThat(MDC.get(LogContext.EVENT_ID)).isEqualTo("e-1");
            assertThat(MDC.get(LogContext.DELIVERY_ID)).isEqualTo("d-1");
            assertThat(MDC.get(LogContext.ATTEMPT)).isEqualTo("3");
        }
        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();

        try (LogContext scope = LogContext.openCarrier(Map.of("x-origin-request-id", "o-2",
                "x-trace-context-version", "2")::get)) {
            assertThat(MDC.get(LogContext.ORIGIN_REQUEST_ID)).as("모르는 버전").isNull();
        }

        try (LogContext scope = LogContext.openInternalHttp(Map.of("x-request-id", "biz-2")::get)) {
            assertThat(MDC.get(LogContext.ORIGIN_REQUEST_ID)).isEqualTo("biz-2");
        }
        try (LogContext scope = LogContext.openCarrier(Map.of("x-request-id", "biz-3")::get)) {
            assertThat(MDC.get(LogContext.ORIGIN_REQUEST_ID)).as("Kafka 에는 X-Request-Id 승격이 없다").isNull();
        }
    }
}

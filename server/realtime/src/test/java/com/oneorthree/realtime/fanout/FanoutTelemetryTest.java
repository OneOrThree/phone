package com.oneorthree.realtime.fanout;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import static org.assertj.core.api.Assertions.assertThat;

/** 발행 시 원인 고르기(계약 §2.2 origin 우선)와 수신 시 버전 검사 (GROMO-2559). */
class FanoutTelemetryTest {

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    @Test
    @DisplayName("이미 있는 원인을 그대로 싣고, 없을 때만 지금 request_id 를 원인으로 승격한다 — 형식이 틀린 값은 뺀다")
    void captureKeepsExistingOriginAndPromotesOnlyWhenAbsent() {
        MDC.put("request_id", "stomp-1");
        assertThat(FanoutTelemetry.capture(null)).isEqualTo(new FanoutTelemetry(1, "stomp-1", null, null));

        MDC.put("origin_request_id", "biz-1");
        MDC.put("origin_trace_id", "123");
        assertThat(FanoutTelemetry.capture("evt-1")).isEqualTo(new FanoutTelemetry(1, "biz-1", "123", "evt-1"));

        MDC.remove("origin_request_id");
        assertThat(FanoutTelemetry.capture(null)).as("원인 trace 만 있어도 지금 요청과 섞지 않는다")
                .isEqualTo(new FanoutTelemetry(1, null, "123", null));

        MDC.clear();
        MDC.put("request_id", "bad value");
        assertThat(FanoutTelemetry.capture(null)).as("담을 게 없으면 wire 에서 빠진다").isNull();
    }

    @Test
    @DisplayName("수신 — v1 만 설치하고 모르는 버전·없는 메타데이터는 빈 scope 다. 닫으면 되돌아간다")
    void installReadsOnlyVersionOne() {
        try (var scope = FanoutTelemetry.install(new FanoutTelemetry(2, "r", "t", "e"))) {
            assertThat(MDC.get("origin_request_id")).isNull();
        }
        try (var scope = FanoutTelemetry.install(null)) {
            assertThat(MDC.get("event_id")).isNull();
        }
        try (var scope = FanoutTelemetry.install(new FanoutTelemetry(1, "r", "t", "e"))) {
            assertThat(MDC.get("origin_request_id")).isEqualTo("r");
            assertThat(MDC.get("origin_trace_id")).isEqualTo("t");
            assertThat(MDC.get("event_id")).isEqualTo("e");
        }
        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }
}

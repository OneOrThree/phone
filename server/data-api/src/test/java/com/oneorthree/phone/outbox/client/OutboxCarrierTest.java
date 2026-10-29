package com.oneorthree.phone.outbox.client;

import com.oneorthree.phone.common.logging.LogScope;
import com.oneorthree.phone.outbox.support.OutboxOrigin;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** carrier 헤더·scope 복원·origin 값 검사의 순수 규칙 (GROMO-2557). 경로 전체는 relay 통합 테스트가 본다. */
class OutboxCarrierTest {

    @AfterEach
    void clear() {
        List.of("event_id", "request_id", "dd.trace_id", "delivery_id", "attempt", "origin_request_id",
                "origin_trace_id").forEach(MDC::remove);
    }

    @Test
    void headersCarryOnlyValidValuesAndAlwaysTheVersion() {
        UUID delivery = UUID.randomUUID();
        OutboxCarrier carrier = new OutboxCarrier("user.withdrawn:abc", delivery, 3, "req-1", "bad trace\r\nX: y");

        assertThat(carrier.headers()).containsExactly(
                Map.entry("X-Origin-Request-Id", "req-1"),
                Map.entry("X-Event-Id", "user.withdrawn:abc"),
                Map.entry("X-Delivery-Id", delivery.toString()),
                Map.entry("X-Attempt", "3"),
                Map.entry("X-Trace-Context-Version", "1"));
    }

    @Test
    void scopeRestoresOnlyItsOwnKeysToThePreviousValues() {
        MDC.put("event_id", "outer-event");
        MDC.put("request_id", "outer-request");
        MDC.put("dd.trace_id", "123");

        try (LogScope ignored = new OutboxCarrier("inner-event", UUID.randomUUID(), 2, null, "456").openScope()) {
            assertThat(MDC.get("event_id")).isEqualTo("inner-event");
            assertThat(MDC.get("attempt")).isEqualTo("2");
            assertThat(MDC.get("origin_trace_id")).isEqualTo("456");
            assertThat(MDC.get("origin_request_id")).isNull();
        }

        assertThat(MDC.get("event_id")).isEqualTo("outer-event");
        assertThat(MDC.get("request_id")).isEqualTo("outer-request");
        assertThat(MDC.get("dd.trace_id")).isEqualTo("123");
        assertThat(MDC.get("delivery_id")).isNull();
        assertThat(MDC.get("attempt")).isNull();
        assertThat(MDC.get("origin_trace_id")).isNull();
    }

    @Test
    void originKeepsRawTraceAndDropsZeroOrOversizedValues() {
        assertThat(OutboxOrigin.of("req", "0")).isEqualTo(new OutboxOrigin("req", null));
        assertThat(OutboxOrigin.of(null, "0").version()).isNull();
        assertThat(OutboxOrigin.of(null, "18446744073709551615").traceId()).isEqualTo("18446744073709551615");
        String hex = "6720d0ec00000000a1b2c3d4e5f60718";
        assertThat(OutboxOrigin.of(null, hex).traceId()).isEqualTo(hex);
        assertThat(OutboxOrigin.of("r".repeat(129), "a".repeat(65))).isEqualTo(new OutboxOrigin(null, null));
        assertThat(OutboxOrigin.of("req", null).version()).isEqualTo((short) 1);
    }
}

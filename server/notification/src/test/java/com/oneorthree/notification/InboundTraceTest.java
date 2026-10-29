package com.oneorthree.notification;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/** carrier 헤더 검사 규칙(GROMO-2582) — Data {@code TraceIdFilter} 와 같은 버전·빈 헤더 규칙. */
class InboundTraceTest {

    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();

    private double dropped(String header) {
        var counter = metrics.find(InboundTrace.DROPPED).tag("header", header).counter();
        return counter == null ? 0 : counter.count();
    }

    @Test
    void versionIsTrimmedAndUnknownVersionDropsTheWholeCarrier() {
        MockHttpServletRequest padded = new MockHttpServletRequest();
        padded.addHeader("X-Trace-Context-Version", " 1");
        padded.addHeader("X-Origin-Request-Id", "req-1");
        assertThat(InboundTrace.fromHttp(padded, metrics).originRequestId()).isEqualTo("req-1");

        MockHttpServletRequest unknown = new MockHttpServletRequest();
        unknown.addHeader("X-Trace-Context-Version", "2");
        unknown.addHeader("X-Origin-Request-Id", "req-2");
        assertThat(InboundTrace.fromHttp(unknown, metrics).originRequestId()).isNull();
        assertThat(dropped("X-Trace-Context-Version")).isEqualTo(1);
    }

    @Test
    void blankHeadersAreAbsentNotDropped() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Trace-Context-Version", "  ");
        request.addHeader("X-Origin-Request-Id", "");
        request.addHeader("X-Origin-Trace-Id", " ");
        request.addHeader("X-Delivery-Id", " ");
        request.addHeader("X-Attempt", "");
        InboundTrace trace = InboundTrace.fromHttp(request, metrics);
        assertThat(trace).isEqualTo(InboundTrace.NONE);
        assertThat(metrics.getMeters()).isEmpty();
    }

    @Test
    void brokenRequestIdIsNotCountedWhenAnOriginHeaderExists() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Origin-Request-Id", "req-1");
        request.addHeader("X-Request-Id", "bad id");
        assertThat(InboundTrace.fromHttp(request, metrics).originRequestId()).isEqualTo("req-1");
        assertThat(dropped("X-Request-Id")).isZero();
    }

    @Test
    void droppedOriginIsNotReplacedByTheCurrentRequestId() {
        MockHttpServletRequest malformed = new MockHttpServletRequest();
        malformed.addHeader("X-Origin-Request-Id", "bad id");
        malformed.addHeader("X-Request-Id", "cur-1");
        InboundTrace trace = InboundTrace.fromHttp(malformed, metrics);
        assertThat(trace.originRequestId()).isNull();
        assertThat(dropped("X-Origin-Request-Id")).isEqualTo(1);

        MockHttpServletRequest unknown = new MockHttpServletRequest();
        unknown.addHeader("X-Trace-Context-Version", "2");
        unknown.addHeader("X-Request-Id", "cur-2");
        assertThat(InboundTrace.fromHttp(unknown, metrics).originRequestId()).isNull();

        MockHttpServletRequest absent = new MockHttpServletRequest();
        absent.addHeader("X-Request-Id", "cur-3");
        assertThat(InboundTrace.fromHttp(absent, metrics).originRequestId()).isEqualTo("cur-3");
    }
}

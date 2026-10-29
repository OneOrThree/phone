package com.oneorthree.realtime.logging;

import ch.qos.logback.classic.AsyncAppender;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.AppenderBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

class ObservationJsonProviderTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Logger LOGGER = (Logger) LoggerFactory.getLogger("obs-provider-test");

    private final ObservationJsonProvider provider = new ObservationJsonProvider(new MockEnvironment()
            .withProperty("OBS_SERVICE", "realtime").withProperty("OBS_ENV", "dev")
            .withProperty("OBS_VERSION", "abc123").withProperty("HOSTNAME", "c0ffee"));

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void writesSchemaAndKeepsDatadogRawBesideCanonicalIds() throws Exception {
        Map<String, Object> json = format(event("hello", null, Map.of(
                "dd.trace_id", "68F1A2B3000000001234ABCD5678EF90", "dd.span_id", "1234567890123456789",
                "request_id", "req-1")));

        assertThat(json).containsEntry("schema_version", 1).containsEntry("log_kind", "application")
                .containsEntry("level", "INFO").containsEntry("logger", "obs-provider-test")
                .containsEntry("thread", Thread.currentThread().getName()).containsEntry("message", "hello")
                .containsEntry("service", "realtime").containsEntry("env", "dev")
                .containsEntry("version", "abc123").containsEntry("instance_id", "c0ffee")
                .containsEntry("request_id", "req-1")
                .containsEntry("dd", Map.of("trace_id", "68F1A2B3000000001234ABCD5678EF90",
                        "span_id", "1234567890123456789"))
                .containsEntry("trace_id", "68f1a2b3000000001234abcd5678ef90")
                .containsEntry("span_id", "112210f47de98115")
                .doesNotContainKeys("exception", "truncated", "original_size_bytes");
        assertThat((String) json.get("timestamp")).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");
        assertThat(UUID.fromString((String) json.get("log_id"))).isNotNull();
    }

    @Test
    void decimalTraceKeepsOnlyDatadogRawBecauseUpperBitsMayBeLost() throws Exception {
        Map<String, Object> json = format(event("m", null, Map.of(
                "dd.trace_id", "1234567890123456789", "dd.span_id", "18446744073709551615")));

        assertThat(json).containsEntry("dd", Map.of("trace_id", "1234567890123456789",
                        "span_id", "18446744073709551615"))
                .containsEntry("span_id", "ffffffffffffffff")
                .doesNotContainKey("trace_id");
    }

    @Test
    void zeroOrMissingTraceMeansNoTraceFields() throws Exception {
        // agent 미활성·활성 span 없음은 "0", agent 부재는 키 자체가 없다. 둘 다 trace 없이 정상 출력한다.
        Map<String, Object> zero = format(event("m", null, Map.of("dd.trace_id", "0", "dd.span_id", "0")));
        Map<String, Object> absent = format(event("m", null, Map.of()));

        for (Map<String, Object> json : List.of(zero, absent)) {
            assertThat(json).doesNotContainKeys("dd", "trace_id", "span_id")
                    .containsEntry("schema_version", 1).containsEntry("message", "m");
        }
        assertThat(format(event("m", null, Map.of("dd.trace_id", "abc", "dd.span_id", "99999999999999999999"))))
                .containsEntry("dd", Map.of("trace_id", "abc", "span_id", "99999999999999999999"))
                .doesNotContainKeys("trace_id", "span_id");
    }

    @Test
    void writesOnlyValidatedAllowlistContext() throws Exception {
        Map<String, String> mdc = new HashMap<>();
        mdc.put("request_id", "bad\nid");
        mdc.put("event_id", "evt-1");
        mdc.put("origin_trace_id", "123456789");
        mdc.put("attempt", "3");
        mdc.put("event_name", "outbox.delivery");
        mdc.put("trace_id", "legacy-not-apm");
        mdc.put("private", "must-not-leak");
        mdc.put("dd.service", "gromo");

        Map<String, Object> json = format(event("m", null, mdc));

        assertThat(json).containsEntry("event_id", "evt-1").containsEntry("origin_trace_id", "123456789")
                .containsEntry("attempt", 3).containsEntry("event_name", "outbox.delivery")
                .doesNotContainKeys("request_id", "trace_id", "legacy_trace_id", "private", "dd.service", "dd");
        assertThat(format(event("m", null, Map.of("attempt", "0", "event_name", "custom.thing"))))
                .doesNotContainKeys("attempt", "event_name");
    }

    @Test
    void masksMessageAndException() throws Exception {
        Map<String, Object> json = format(event("login email=user@example.com phone 010-1234-5678 rrn 900101-1234567",
                new IllegalStateException("password=hunter2 contact mail@example.org"), Map.of()));

        assertThat((String) json.get("message")).isEqualTo("login email=**** phone 010-****-5678 rrn 900101-1******");
        assertThat((String) json.get("exception")).contains("password=****", "mai****@****.***")
                .doesNotContain("hunter2", "mail@example.org");
    }

    @Test
    void exceptionWithNewlinesStaysOneJsonLine() throws Exception {
        String line = provider.format(event("m", new IllegalStateException("first\nsecond\r\nthird"), Map.of()));

        assertThat(line.indexOf('\n')).isEqualTo(line.length() - 1);
        Map<String, Object> json = parse(line);
        assertThat((String) json.get("exception")).startsWith("java.lang.IllegalStateException: first\nsecond")
                .contains("\tat ");
    }

    @Test
    void truncatesOnUtf8BoundaryAndReportsOriginalSize() throws Exception {
        String message = "a" + "😀".repeat(5000); // 1 + 4*5000 바이트, 4바이트 문자 경계가 상한과 어긋난다
        ILoggingEvent event = event(message, new IllegalStateException("가".repeat(12000)),
                Map.of("request_id", "req-long"));
        int exceptionBytes = ThrowableProxyUtil.asString(event.getThrowableProxy())
                .getBytes(StandardCharsets.UTF_8).length;

        Map<String, Object> json = format(event);

        String cutMessage = (String) json.get("message");
        String cutException = (String) json.get("exception");
        assertThat(cutMessage.getBytes(StandardCharsets.UTF_8)).hasSize(1 + 4 * 4095);
        assertThat(message).startsWith(cutMessage);
        assertThat(cutException.getBytes(StandardCharsets.UTF_8).length)
                .isLessThanOrEqualTo(ObservationJsonProvider.EXCEPTION_LIMIT_BYTES)
                .isGreaterThan(ObservationJsonProvider.EXCEPTION_LIMIT_BYTES - 3);
        assertThat(cutException).doesNotContain("�").endsWith("가");
        assertThat(json).containsEntry("truncated", true)
                .containsEntry("original_size_bytes", 1 + 4 * 5000 + exceptionBytes)
                .containsEntry("request_id", "req-long");
    }

    @Test
    void logIdIsNewForEveryEvent() throws Exception {
        assertThat(format(event("a", null, Map.of())).get("log_id"))
                .isNotEqualTo(format(event("a", null, Map.of())).get("log_id"));
    }

    @Test
    void invalidRuntimeMetadataIsOmitted() throws Exception {
        ObservationJsonProvider invalid = new ObservationJsonProvider(new MockEnvironment()
                .withProperty("OBS_SERVICE", "business api").withProperty("OBS_ENV", "")
                .withProperty("OBS_VERSION", "${IMAGE_REVISION}"));

        assertThat(parse(invalid.format(event("m", null, Map.of()))))
                .doesNotContainKeys("service", "env", "version", "instance_id").containsEntry("message", "m");
    }

    @Test
    void formatFailureStillWritesOneLine() throws Exception {
        LoggingEvent broken = new LoggingEvent(Logger.class.getName(), LOGGER, Level.WARN, "m", null, null) {
            @Override
            public String getFormattedMessage() {
                throw new IllegalStateException("broken toString");
            }
        };

        assertThat(parse(provider.format(broken))).containsEntry("level", "WARN")
                .containsEntry("message", "log format failed: java.lang.IllegalStateException");
    }

    /** AsyncAppender 작업 스레드에서 encode 해도 로그를 낸 시점의 이벤트 MDC 가 나온다. */
    @Test
    void readsEventMdcSnapshotNotTheEncodingThread() throws Exception {
        CountDownLatch mdcChanged = new CountDownLatch(1);
        List<String> lines = new CopyOnWriteArrayList<>();
        AppenderBase<ILoggingEvent> encoding = new AppenderBase<>() {
            @Override
            protected void append(ILoggingEvent event) {
                try {
                    mdcChanged.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                lines.add(provider.format(event));
            }
        };
        AsyncAppender async = new AsyncAppender();
        encoding.setContext(LOGGER.getLoggerContext());
        async.setContext(LOGGER.getLoggerContext());
        async.addAppender(encoding);
        encoding.start();
        async.start();
        Logger logger = LOGGER.getLoggerContext().getLogger("obs-provider-async-test");
        logger.setAdditive(false);
        logger.addAppender(async);
        try {
            MDC.put("request_id", "req-at-log");
            MDC.put("dd.trace_id", "11111111111111111111111111111111");
            MDC.put("dd.span_id", "42");
            logger.info("async");
            MDC.put("request_id", "req-after-log");
            MDC.put("dd.trace_id", "22222222222222222222222222222222");
            mdcChanged.countDown();
        } finally {
            async.stop();
            logger.detachAppender(async);
        }

        assertThat(lines).hasSize(1);
        Map<String, Object> json = parse(lines.get(0));
        assertThat(json).containsEntry("request_id", "req-at-log")
                .containsEntry("trace_id", "11111111111111111111111111111111")
                .containsEntry("span_id", "000000000000002a")
                .containsEntry("thread", Thread.currentThread().getName());
    }

    private static ILoggingEvent event(String message, Throwable error, Map<String, String> mdc) {
        LoggingEvent event = new LoggingEvent(Logger.class.getName(), LOGGER, Level.INFO, message, error, null);
        event.setMDCPropertyMap(mdc);
        return event;
    }

    private Map<String, Object> format(ILoggingEvent event) throws Exception {
        return parse(provider.format(event));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parse(String line) throws Exception {
        assertThat(line).endsWith("\n");
        assertThat(line.indexOf('\n')).isEqualTo(line.length() - 1);
        return JSON.readValue(line, Map.class);
    }

    @Test
    void hugeInputWithoutAtSignIsMaskedInLinearTimeAfterPreCut() {
        String message = "path=/" + "a".repeat(200_000);

        Map<String, Object> json = assertTimeoutPreemptively(Duration.ofSeconds(2),
                () -> format(event(message, null, Map.of())));

        assertThat(((String) json.get("message")).getBytes(StandardCharsets.UTF_8).length)
                .isLessThanOrEqualTo(ObservationJsonProvider.MESSAGE_LIMIT_BYTES);
        assertThat(json).containsEntry("truncated", true).containsEntry("original_size_bytes", 200_006);
    }

    @Test
    void preCutKeepsUtf8BoundaryAndReportsRawSize() throws Exception {
        String message = "😀".repeat(20_000); // 80,000 바이트 > 한도의 2배
        Map<String, Object> json = format(event(message, null, Map.of()));

        String cut = (String) json.get("message");
        assertThat(cut).doesNotContain("�");
        assertThat(cut.getBytes(StandardCharsets.UTF_8).length)
                .isLessThanOrEqualTo(ObservationJsonProvider.MESSAGE_LIMIT_BYTES);
        assertThat(json).containsEntry("truncated", true).containsEntry("original_size_bytes", 80_000);
    }
}

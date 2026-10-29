package com.oneorthree.phone.common.logging;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.CoreConstants;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.logging.logback.StructuredLogEncoder;
import org.springframework.mock.env.MockEnvironment;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GROMO-2560 로컬 측정(V14 의 «앱 로깅 비용» 부분). 기본 빌드에서는 돌지 않는다 — 환경변수 {@code LOGGING_PERF=1} 일 때만 돈다.
 * 같은 이벤트를 «옛 콘솔 패턴 인코더(main 의 logback-spring.xml 패턴)» 대 «새 StructuredLogEncoder + ObservationJsonProvider» 로
 * N 번 인코딩해 건당 시간과 바이트 수를 비교한다. 로컬 단일 JVM·대표 부하 아님. 요청 p95/p99 가 아니라 인코딩 비용만 본다.
 *
 * <pre>
 * LOGGING_PERF=1 SPRING_PROFILES_ACTIVE=ci ./gradlew cleanTest test --no-daemon --tests '*LoggingEncodingPerfTest' -i
 * </pre>
 * 결과 표는 stdout 과 {@code build/logging-perf.txt} 에 남는다.
 */
@EnabledIfEnvironmentVariable(named = "LOGGING_PERF", matches = "1")
class LoggingEncodingPerfTest {

    /** origin/main 의 logback-spring.xml APP_PATTERN 그대로(2553 이 넣은 request_id 칸이 없는 옛 패턴). */
    private static final String OLD_PATTERN =
            "[%d{yyyy-MM-dd HH:mm:ss.SSS}] [%thread] %-5level %logger{36} [%X{trace_id}] [%X{user_id}] - %mask%n";
    private static final Logger LOGGER = new LoggerContext().getLogger("perf.sample.Logger");
    private static final int ROUNDS = 5;

    private record Scenario(String name, String message, Throwable error, int perRound) {
    }

    @Test
    void compareOldPatternAndStructuredJson() throws Exception {
        LoggerContext context = new LoggerContext();
        Map<String, String> rules = new HashMap<>();
        rules.put("mask", MaskingConverter.class.getName());
        context.putObject(CoreConstants.PATTERN_RULE_REGISTRY, rules);
        context.putObject("org.springframework.core.env.Environment", new MockEnvironment()
                .withProperty("OBS_SERVICE", "data-api").withProperty("OBS_ENV", "dev")
                .withProperty("OBS_VERSION", "perf").withProperty("HOSTNAME", "perf-host"));

        PatternLayoutEncoder oldEncoder = new PatternLayoutEncoder();
        oldEncoder.setContext(context);
        oldEncoder.setPattern(OLD_PATTERN);
        oldEncoder.setCharset(StandardCharsets.UTF_8);
        oldEncoder.start();

        StructuredLogEncoder newEncoder = new StructuredLogEncoder();
        newEncoder.setContext(context);
        newEncoder.setFormat(ObservationJsonProvider.class.getName());
        newEncoder.setCharset(StandardCharsets.UTF_8);
        newEncoder.start();

        List<Scenario> scenarios = List.of(
                new Scenario("짧은 줄(약 60B)", "order accepted id=12345 status=OK", null, 4000),
                new Scenario("4 KiB 메시지", "x".repeat(4 * 1024), null, 2000),
                new Scenario("40 KiB 메시지(JSON 은 16 KiB 로 자름)", "x ".repeat(20 * 1024), null, 400),
                new Scenario("스택 포함(깊이 40)", "request failed", deepError(40), 1000),
                new Scenario("스택 포함(깊이 800, JSON 은 32 KiB 로 자름)", "request failed", deepError(800), 100));

        StringBuilder out = new StringBuilder("""
                로컬 macOS 단일 JVM, 대표 부하 아님. 인코딩 비용만(요청 p95/p99 아님). 건당 System.nanoTime 계측 오버헤드(수십 ns) 포함.
                옛 = PatternLayoutEncoder(main 패턴 + %mask), 새 = StructuredLogEncoder + ObservationJsonProvider. 단위 µs.
                | 시나리오 | 방식 | 건수 | p50 | p95 | p99 | 최대 | 출력 바이트 |
                | --- | --- | --- | --- | --- | --- | --- | --- |
                """);
        for (Scenario s : scenarios) {
            // 이벤트는 건마다 새로 만든다(타이머 밖). 같은 이벤트를 재사용하면 logback 이 스택 줄 문자열을 이벤트 안에 캐시해
            // 두 번째부터는 스택 비용이 사라져 실제 로깅(건마다 새 이벤트)보다 훨씬 싸게 나온다.
            for (int i = 0; i < s.perRound() * 3; i++) { // 워밍업: 두 인코더 모두 JIT 이 안정되게
                oldEncoder.encode(event(s));
                newEncoder.encode(event(s));
            }
            long[] oldNs = new long[s.perRound() * ROUNDS];
            long[] newNs = new long[s.perRound() * ROUNDS];
            int bytesOld = 0;
            int bytesNew = 0;
            for (int r = 0; r < ROUNDS; r++) { // 교대로 재서 JIT·GC 편향이 한쪽에 몰리지 않게
                ILoggingEvent[] batch = events(s);
                for (int i = 0; i < s.perRound(); i++) {
                    long t0 = System.nanoTime();
                    byte[] a = oldEncoder.encode(batch[i]);
                    oldNs[r * s.perRound() + i] = System.nanoTime() - t0;
                    bytesOld = a.length;
                }
                batch = events(s);
                for (int i = 0; i < s.perRound(); i++) {
                    long t0 = System.nanoTime();
                    byte[] b = newEncoder.encode(batch[i]);
                    newNs[r * s.perRound() + i] = System.nanoTime() - t0;
                    bytesNew = b.length;
                }
            }
            assertThat(bytesNew).isPositive();
            out.append(row(s.name(), "옛 패턴", oldNs, bytesOld)).append(row(s.name(), "새 JSON", newNs, bytesNew));
        }
        System.out.println(out);
        Files.writeString(Path.of("build/logging-perf.txt"), out.toString());
    }

    private static ILoggingEvent event(Scenario s) {
        LoggingEvent event = new LoggingEvent(Logger.class.getName(), LOGGER, Level.INFO, s.message(), s.error(), null);
        event.setMDCPropertyMap(Map.of("trace_id", "5d1f3a7e-aaaa-bbbb-cccc-0123456789ab", "user_id", "42",
                "request_id", "req-perf-1", "dd.trace_id", "68f1a2b3000000001234abcd5678ef90", "dd.span_id", "1234567890123456789"));
        return event;
    }

    private static ILoggingEvent[] events(Scenario s) {
        ILoggingEvent[] batch = new ILoggingEvent[s.perRound()];
        for (int i = 0; i < batch.length; i++) {
            batch[i] = event(s);
        }
        return batch;
    }

    private static Throwable deepError(int depth) {
        IllegalStateException e = new IllegalStateException("boom");
        StackTraceElement[] frames = new StackTraceElement[depth];
        for (int i = 0; i < depth; i++) {
            frames[i] = new StackTraceElement("com.example.service.Layer" + (i % 20), "handle" + i, "Layer.java", 100 + i);
        }
        e.setStackTrace(frames);
        return e;
    }

    private static String row(String scenario, String kind, long[] ns, int bytes) {
        long[] sorted = ns.clone();
        Arrays.sort(sorted);
        return "| %s | %s | %d | %.1f | %.1f | %.1f | %.1f | %d |%n".formatted(scenario, kind, ns.length,
                us(sorted, 0.50), us(sorted, 0.95), us(sorted, 0.99), sorted[sorted.length - 1] / 1000.0, bytes);
    }

    private static double us(long[] sorted, double q) {
        return sorted[(int) Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] / 1000.0;
    }
}

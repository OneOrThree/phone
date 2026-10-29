package com.oneorthree.phone.common.logging;

import ch.qos.logback.classic.LoggerContext;
import net.logstash.logback.argument.StructuredArguments;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실제 logback-spring.xml·application-{profile}.yml 로 Boot 로깅을 초기화한 <b>별도 JVM</b> 의 stdout 을 본다. 같은 JVM 에서 로깅 시스템을
 * 다시 초기화하면 캐시된 Spring 테스트 컨텍스트의 로그 설정을 덮으므로 프로세스를 나눈다.
 */
@Timeout(value = 3, unit = TimeUnit.MINUTES)
class ObservationJsonProfileTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @TempDir
    Path workDir;

    @ParameterizedTest
    @ValueSource(strings = {"dev", "prod"})
    @SuppressWarnings("unchecked")
    void jsonProfilesWriteOneJsonObjectPerStdoutLine(String profile) throws Exception {
        List<String> lines = run(profile);

        assertThat(lines).isNotEmpty().allSatisfy(line -> assertThat(line).startsWith("{").endsWith("}"));
        String probeLine = lines.stream().filter(line -> line.contains("probe-line")).findFirst().orElseThrow();
        System.out.println(probeLine); // 보고용 실제 한 줄 — 테스트 결과 XML 의 system-out 에 남는다
        for (String line : lines) {
            JSON.readValue(line, Map.class);
        }
        Map<String, Object> probe = JSON.readValue(probeLine, Map.class);
        assertThat(probe).containsEntry("message", "probe-line email=****");
        assertThat(probe).containsEntry("schema_version", 1).containsEntry("log_kind", "application")
                .containsEntry("service", "data-api").containsEntry("env", profile)
                .containsEntry("version", "rev-probe").containsEntry("instance_id", "probe-host")
                .containsEntry("request_id", "req-probe").containsEntry("trace_id", "0123456789abcdef0123456789abcdef")
                .containsEntry("span_id", "000000000000002a").containsEntry("legacy_trace_id", "legacy-probe")
                .doesNotContainKey("private");
        assertThat((String) probe.get("exception")).startsWith("java.lang.IllegalStateException: boom\nsecond line");
        // APP_FILE 은 텍스트 그대로, user-activity 는 콘솔에 섞이지 않고 자기 JSON 파일로만 간다.
        assertThat(Files.readString(workDir.resolve("logs/app.log")))
                .contains("probe-line email=****").doesNotStartWith("{");
        assertThat(lines).noneMatch(line -> line.contains("ua-probe"));
        assertThat(Files.readString(workDir.resolve("logs/user-activity.log"))).contains("ua-probe");
    }

    @Test
    void ciProfileKeepsHumanReadableConsole() throws Exception {
        List<String> lines = run("ci");

        assertThat(lines).anyMatch(line -> line.contains("probe-line")).anyMatch(line -> line.contains("ua-probe"))
                .noneMatch(line -> line.startsWith("{"));
    }

    private List<String> run(String profile) throws Exception {
        Path stderr = workDir.resolve("stderr.txt");
        ProcessBuilder builder = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), "-Dspring.profiles.active=" + profile,
                Probe.class.getName())
                .directory(workDir.toFile())
                .redirectError(stderr.toFile());
        Map<String, String> env = builder.environment();
        env.remove("SPRING_PROFILES_ACTIVE");
        env.put("OBS_SERVICE", "data-api");
        env.put("OBS_ENV", profile);
        env.put("OBS_VERSION", "rev-probe");
        env.put("HOSTNAME", "probe-host");
        Process process = builder.start();
        String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertThat(process.waitFor(2, TimeUnit.MINUTES)).isTrue();
        assertThat(process.exitValue()).as(stdout + Files.readString(stderr)).isZero();
        return stdout.lines().filter(line -> !line.isBlank()).toList();
    }

    /** 자식 JVM: 빈 컨텍스트로 Boot 로깅만 초기화하고 한 줄을 낸다. */
    static final class Probe {

        public static void main(String[] args) {
            try (ConfigurableApplicationContext ignored = new SpringApplicationBuilder(Probe.class)
                    .web(WebApplicationType.NONE).bannerMode(Banner.Mode.OFF).run()) {
                MDC.put("request_id", "req-probe");
                MDC.put("dd.trace_id", "0123456789ABCDEF0123456789ABCDEF");
                MDC.put("dd.span_id", "42");
                MDC.put("private", "must-not-leak");
                MDC.put("trace_id", "legacy-probe");
                LoggerFactory.getLogger("probe").info("probe-line email=probe@example.com",
                        new IllegalStateException("boom\nsecond line"));
                // UserActivityEventLogger 처럼 kv 인자로 — UA 인코더는 message 대신 인자를 싣는다.
                LoggerFactory.getLogger("user-activity").info("ua {}", StructuredArguments.kv("event", "ua-probe"));
            }
            ((LoggerContext) LoggerFactory.getILoggerFactory()).stop();
        }
    }
}

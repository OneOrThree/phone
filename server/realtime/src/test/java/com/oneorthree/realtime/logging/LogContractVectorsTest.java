package com.oneorthree.realtime.logging;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.LoggingEvent;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 네 서비스(data-api·business-api·notification·realtime) 공통 입력표로 마스킹·사전 자르기 꼬리·trace 정규화가 같은
 * 결과를 내는지 본다. 표는 서비스마다 test resources 에 같은 바이트로 복사돼 있다(서비스 간 공유 코드 없음).
 * 해시가 다르면 복사본이 어긋난 것이다 — 표를 바꾸면 네 복사본과 네 테스트의 {@link #VECTORS_SHA256} 을 함께 바꾼다.
 */
class LogContractVectorsTest {

    static final String VECTORS_SHA256 = "314e827b3e1244e90513a82cb81365db264b278e038a50fc00b9f57bd01cec08";
    private static final Logger LOGGER = (Logger) LoggerFactory.getLogger("obs-contract-test");
    // 마스킹되면 "secret=****" 로 줄어드는 앞부분 — 사전 자르기 꼬리가 실제 출력 message(16 KiB) 안으로 들어오게 한다.
    private static final String SHRINKING_PAD = "secret=";

    @Test
    void tableIsTheSharedCopy() throws Exception {
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(table()));

        assertThat(hash).isEqualTo(VECTORS_SHA256);
    }

    @Test
    void everyRowGivesTheSharedResult() throws Exception {
        List<String[]> rows = rows();
        assertThat(rows).isNotEmpty();
        for (String[] row : rows) {
            String given = row[1];
            String actual = switch (row[0]) {
                case "mask" -> LogMasking.mask(given);
                case "cut" -> LogMasking.mask(LogMasking.dropCutToken(given.substring(0, given.indexOf('|'))));
                case "raw" -> TraceIds.raw(given);
                case "trace" -> TraceIds.traceId(given);
                case "span" -> TraceIds.spanId(given);
                default -> throw new IllegalArgumentException("모르는 종류: " + row[0]);
            };
            boolean nullable = !row[0].equals("mask") && !row[0].equals("cut");

            assertThat(actual).as(String.join(" | ", row)).isEqualTo(nullable && row[2].isEmpty() ? null : row[2]);
        }
    }

    /** cut 줄의 '|' 가 정확히 한도의 2배(사전 자르기 지점)에 오게 만들어 provider 에 넣는다 — 잘린 조각이 출력에 안 남는다. */
    @Test
    void cutRowsLeaveNoPartialTokenInTheOutputMessage() throws Exception {
        ObservationJsonProvider provider = new ObservationJsonProvider(new MockEnvironment());
        for (String[] row : rows()) {
            if (!row[0].equals("cut")) {
                continue;
            }
            int bar = row[1].indexOf('|');
            String head = row[1].substring(0, bar);
            int fill = 2 * ObservationJsonProvider.MESSAGE_LIMIT_BYTES - SHRINKING_PAD.length() - 1
                    - head.getBytes(StandardCharsets.UTF_8).length;
            String message = SHRINKING_PAD + "x".repeat(fill) + " " + head + row[1].substring(bar + 1);
            LoggingEvent event = new LoggingEvent(Logger.class.getName(), LOGGER, Level.INFO, message, null, null);
            event.setMDCPropertyMap(Map.of());

            Map<?, ?> json = new ObjectMapper().readValue(provider.format(event), Map.class);

            assertThat(json.get("message")).as(row[1]).isEqualTo(SHRINKING_PAD + "**** " + row[2]);
            assertThat(json.get("truncated")).isEqualTo(true);
        }
    }

    private static byte[] table() throws IOException {
        try (InputStream in = LogContractVectorsTest.class.getResourceAsStream("/log-contract-vectors.tsv")) {
            assertThat(in).as("test resources 의 log-contract-vectors.tsv").isNotNull();
            return in.readAllBytes();
        }
    }

    private static List<String[]> rows() throws IOException {
        List<String[]> rows = new ArrayList<>();
        for (String line : new String(table(), StandardCharsets.UTF_8).split("\n")) {
            if (!line.isEmpty() && !line.startsWith("#")) {
                rows.add(line.split("\t", -1));
            }
        }
        return rows;
    }
}

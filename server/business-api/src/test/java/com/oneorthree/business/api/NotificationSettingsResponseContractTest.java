package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class NotificationSettingsResponseContractTest extends UpstreamTestBase {
    static Stream<Arguments> invalidQuietTimes() {
        return Stream.of("nightStartTime", "nightEndTime").flatMap(field ->
                Stream.of("25:99", "invalid", "12:34:56", "7:05", "07:5", "24:00", "", " 07:00", "07:00Z")
                        .map(value -> Arguments.of(field, value)));
    }

    @ParameterizedTest
    @MethodSource("invalidQuietTimes")
    void invalidUpstreamTimeCannotBecomeASettingThatTheNextWriteRejects(String field, String time) throws Exception {
        String body = ALL_DISABLED.replace("\"" + field + "\":null", "\"" + field + "\":\"" + time + "\"");
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200, body));
        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        // 같은 값은 공개 PUT 계약에서도 유효하지 않다. GET 성공으로 노출하면 다른 토글까지 저장 못 한다.
        mockMvc.perform(put(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json").content(body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
        assertThat(NOTI.received()).hasSize(1);
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200, ALL_DISABLED));
        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk());
    }

    static Stream<Arguments> validQuietTimes() {
        return Stream.of(Arguments.of(null, null), Arguments.of("00:00", "23:59"),
                Arguments.of("23:59", "00:00"), Arguments.of(null, "07:00"),
                Arguments.of("22:00", null), Arguments.of("22:00", "07:00"));
    }

    @ParameterizedTest
    @MethodSource("validQuietTimes")
    void aValidReadCanBeWrittenBackWhileChangingOnlyAnotherToggle(String start, String end) throws Exception {
        String body = ALL_DISABLED.replace("\"nightStartTime\":null", "\"nightStartTime\":" + jsonTime(start))
                .replace("\"nightEndTime\":null", "\"nightEndTime\":" + jsonTime(end));
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200, body));
        String read = mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(read).contains("\"nightStartTime\":" + jsonTime(start), "\"nightEndTime\":" + jsonTime(end));
        stubActiveUser(USER);
        UUID command = UUID.randomUUID();
        DATA.on("PUT " + INTERNAL_PATH + "-commands", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + command + "\",\"eventId\":\"quiet-settings\",\"version\":1}"));
        DATA.on("POST /internal/outbox-commands/" + command + "/delivered",
                request -> new MockUpstream.Response(204, null));
        NOTI.on("PUT " + INTERNAL_PATH, request -> new MockUpstream.Response(204, null));
        mockMvc.perform(put(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json").content(read.replace("\"soundEnabled\":false", "\"soundEnabled\":true")))
                .andExpect(status().isNoContent());
        assertThat(NOTI.receivedFor("PUT " + INTERNAL_PATH)).singleElement().satisfies(request ->
                assertThat(request.body()).contains("\"soundEnabled\":true", "\"nightStartTime\":" + jsonTime(start),
                        "\"nightEndTime\":" + jsonTime(end)));
        assertThat(DATA.hits("POST /internal/outbox-commands/" + command + "/delivered")).isEqualTo(1);
    }

    private static String jsonTime(String time) {
        return time == null ? "null" : "\"" + time + "\"";
    }

    static Stream<Arguments> incompleteCommands() {
        String identity = "\"commandId\":\"11111111-1111-4111-8111-111111111111\",\"eventId\":\"settings\"";
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"11111111-1111-4111-8111-111111111111\",\"version\":2}"),
                Arguments.of(200, "{" + identity + "}"),
                Arguments.of(200, "{" + identity + ",\"version\":null}"),
                Arguments.of(200, "{" + identity + ",\"version\":0}"),
                Arguments.of(200, "{" + identity + ",\"version\":-1}"),
                Arguments.of(200, "{" + identity + ",\"version\":-9223372036854775808}"));
    }

    static Stream<Arguments> absentSettings() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"));
    }

    @ParameterizedTest
    @MethodSource("absentSettings")
    void absentSettingsAreAContractError(int responseStatus, String body) throws Exception {
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(responseStatus, body));
        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @MethodSource("incompleteCommands")
    void incompleteCommandStopsBeforeApplyAndCanRetry(int responseStatus, String body) throws Exception {
        stubActiveUser(USER);
        String record = "PUT " + INTERNAL_PATH + "-commands";
        DATA.on(record, request -> new MockUpstream.Response(responseStatus, body));
        // Noti는 오래된 version에도 204를 반환하므로 상류 오류에 기대어 우연히 막히면 안 된다.
        NOTI.on("PUT " + INTERNAL_PATH, request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/11111111-1111-4111-8111-111111111111/delivered",
                request -> new MockUpstream.Response(204, null));
        mockMvc.perform(put(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "incomplete-settings")
                        .contentType("application/json").content(ALL_DISABLED))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(NOTI.received()).isEmpty();
        assertThat(DATA.received()).noneMatch(request -> request.path().contains("/delivered"));

        UUID command = UUID.randomUUID();
        DATA.on(record, request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + command + "\",\"eventId\":\"settings-retry\",\"version\":2}"));
        NOTI.on("PUT " + INTERNAL_PATH, request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/" + command + "/delivered",
                request -> new MockUpstream.Response(204, null));
        mockMvc.perform(put(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "incomplete-settings")
                        .contentType("application/json").content(ALL_DISABLED))
                .andExpect(status().isNoContent());
        assertThat(NOTI.hits("PUT " + INTERNAL_PATH)).isEqualTo(1);
        assertThat(NOTI.received().get(0).query()).contains("version=2");
        assertThat(DATA.hits("POST /internal/outbox-commands/" + command + "/delivered")).isEqualTo(1);
        assertThat(DATA.receivedFor(record)).hasSize(2).satisfies(requests ->
                assertThat(requests.get(0).header("Idempotency-Key"))
                        .isEqualTo(requests.get(1).header("Idempotency-Key")));
    }

    private static final UUID USER = UUID.randomUUID();
    private static final String PUBLIC_PATH = "/api/v1/users/me/notification-settings";
    private static final String INTERNAL_PATH = "/internal/users/" + USER + "/notification-settings";
    private static final String ALL_DISABLED = """
            {"notificationEnabled":false,"soundEnabled":false,"nightModeEnabled":false,
             "nightStartTime":null,"nightEndTime":null}""";

    @ParameterizedTest
    @ValueSource(strings = {
            "{}",
            "{\"notificationEnabled\":true}",
            "{\"soundEnabled\":true}",
            "{\"nightModeEnabled\":true}",
            "{\"notificationEnabled\":true,\"soundEnabled\":true}",
            "{\"notificationEnabled\":true,\"nightModeEnabled\":true}",
            "{\"soundEnabled\":true,\"nightModeEnabled\":true}",
            "{\"notificationEnabled\":null,\"soundEnabled\":true,\"nightModeEnabled\":true}",
            "{\"notificationEnabled\":true,\"soundEnabled\":null,\"nightModeEnabled\":true}",
            "{\"notificationEnabled\":true,\"soundEnabled\":true,\"nightModeEnabled\":null}"
    })
    void missingDecisionCannotBePresentedAsDisabledAndACompleteResponseCanRetry(String body) throws Exception {
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200, body));

        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(NOTI.hits("GET " + INTERNAL_PATH)).isEqualTo(1);
        assertThat(DATA.received()).isEmpty();

        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200, ALL_DISABLED));
        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notificationEnabled").value(false))
                .andExpect(jsonPath("$.soundEnabled").value(false))
                .andExpect(jsonPath("$.nightModeEnabled").value(false));
    }

    @Test
    void optionalUnsetTimesAndExplicitFalseRemainValid() throws Exception {
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200,
                "{\"notificationEnabled\":false,\"soundEnabled\":false,\"nightModeEnabled\":false}"));
        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notificationEnabled").value(false))
                .andExpect(jsonPath("$.soundEnabled").value(false))
                .andExpect(jsonPath("$.nightModeEnabled").value(false));
    }

    @Test
    void settingsWithAnOvernightWindowArePreserved() throws Exception {
        NOTI.on("GET " + INTERNAL_PATH, request -> new MockUpstream.Response(200, """
                {"notificationEnabled":true,"soundEnabled":false,"nightModeEnabled":true,
                 "nightStartTime":"22:00","nightEndTime":"07:00"}"""));
        mockMvc.perform(get(PUBLIC_PATH).header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notificationEnabled").value(true))
                .andExpect(jsonPath("$.soundEnabled").value(false))
                .andExpect(jsonPath("$.nightModeEnabled").value(true))
                .andExpect(jsonPath("$.nightStartTime").value("22:00"))
                .andExpect(jsonPath("$.nightEndTime").value("07:00"));
    }

    @ParameterizedTest
    @ValueSource(longs = {1, 2, Long.MAX_VALUE})
    void disablingAllSettingsStillPersistsAndAppliesBeforeAcknowledging(long version) throws Exception {
        UUID command = UUID.randomUUID();
        stubActiveUser(USER);
        DATA.on("PUT " + INTERNAL_PATH + "-commands", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + command + "\",\"eventId\":\"settings-disabled\",\"version\":" + version + "}"));
        NOTI.on("PUT " + INTERNAL_PATH, request -> new MockUpstream.Response(204, null));
        String delivered = "POST /internal/outbox-commands/" + command + "/delivered";
        DATA.on(delivered, request -> new MockUpstream.Response(204, null));

        mockMvc.perform(put(PUBLIC_PATH)
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "disable-settings")
                        .contentType("application/json").content(ALL_DISABLED))
                .andExpect(status().isNoContent());

        assertThat(DATA.receivedFor("PUT " + INTERNAL_PATH + "-commands")).singleElement().satisfies(request ->
                assertThat(request.body()).contains("\"notificationEnabled\":false", "\"soundEnabled\":false",
                        "\"nightModeEnabled\":false"));
        assertThat(NOTI.receivedFor("PUT " + INTERNAL_PATH)).singleElement().satisfies(request -> {
            assertThat(request.body()).contains("\"notificationEnabled\":false", "\"soundEnabled\":false",
                    "\"nightModeEnabled\":false");
            assertThat(request.query()).contains("version=" + version);
        });
        assertThat(DATA.hits(delivered)).isEqualTo(1);
    }
}

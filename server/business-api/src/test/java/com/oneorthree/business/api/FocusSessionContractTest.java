package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 집중 세션 수명주기 공개 표면 (GROMO-1764) — 무접두 경로가 Business 에 있고, Data 로는
 * {@code /internal/users/{userId}/…} 로만 나간다는 것을 실제 필터·컨트롤러·HTTP 로 확인한다.
 */
class FocusSessionContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000011");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000011");
    private static final UUID ISLAND = UUID.fromString("cccccccc-0000-0000-0000-000000000011");
    private static final UUID FOCUS = UUID.fromString("dddddddd-0000-0000-0000-000000000011");
    private static final String KEY = "eeeeeeee-0000-5000-8000-000000000011";
    private static final String INTERNAL = "/internal/users/" + USER;
    private static final String DATA_START = "POST " + INTERNAL + "/focus-sessions";
    private static final String DATA_CURRENT = "GET " + INTERNAL + "/focus-sessions/current";
    private static final String DATA_PAUSE = "POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/pause";
    private static final String DATA_SUMMARY = "GET " + INTERNAL + "/focus-summary";
    private static final String START_BODY =
            "{\"islandId\":\"" + ISLAND + "\",\"subject\":\"알고리즘\",\"targetMinutes\":60}";
    private static final String STATE = "{\"id\":\"" + FOCUS + "\",\"islandId\":\"" + ISLAND + "\","
            + "\"subject\":\"알고리즘\",\"targetMinutes\":60,\"status\":\"active\",\"activeSeconds\":0,"
            + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"startedAt\":\"2026-09-17T00:00:00Z\","
            + "\"restStartedAt\":null,\"version\":1}";

    @Test
    void startForwardsSignedActorToInternalPathAndReturnsCreatedEnvelope() throws Exception {
        DATA.on(DATA_START, request -> ok(STATE));
        mockMvc.perform(write(post("/focus-sessions"), START_BODY).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.version").value(1))
                .andExpect(jsonPath("$.data.restStartedAt").doesNotExist())
                .andExpect(jsonPath("$.id").doesNotExist());
        assertThat(DATA.hits(DATA_START)).isEqualTo(1);
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(sent.header("idempotency-key")).isEqualTo(KEY);
        assertThat(sent.body()).contains(ISLAND.toString(), "알고리즘", "60");
    }

    /** 세션 없음은 정상값이다 — Data 의 명시 null 키를 벗겨 {@code data:null} 로 내린다. */
    @Test
    void currentReturnsExplicitNullWhenNoSession() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.error").doesNotExist());
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + STATE + "}"));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(FOCUS.toString()));
    }

    /** 빈 200 은 「세션 없음」의 증거가 아니다 — 계약 불일치로 502 다. */
    @Test
    void currentRejectsEmptyBodyAsAbsentSession() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok(""));
        mockMvc.perform(auth(get("/focus-sessions/current"))).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void summaryPassesQueryThroughAndKeepsJudgementUpstream() throws Exception {
        DATA.on(DATA_SUMMARY, request -> ok("{\"date\":\"2026-09-17\",\"completedSeconds\":60,"
                + "\"currentSessionSecondsToday\":30,\"totalSeconds\":90,"
                + "\"serverNow\":\"2026-09-17T00:00:00Z\"}"));
        mockMvc.perform(auth(get("/me/focus-summary")).queryParam("date", "2026-09-17")
                        .queryParam("timezone", "Asia/Seoul"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalSeconds").value(90));
        assertThat(DATA.received().get(0).query()).contains("date=2026-09-17", "timezone=Asia/Seoul");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"expectedVersion\":null}", "{\"expectedVersion\":\"1\"}",
            "{\"expectedVersion\":1.5}", "{\"expectedVersion\":true}",
            "{\"expectedVersion\":1,\"status\":\"paused\"}"})
    void pauseRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/pause"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "9007199254740992"})
    void pauseRejectsVersionOutsideSafeRange(String version) throws Exception {
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/pause"),
                        "{\"expectedVersion\":" + version + "}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("expectedVersion"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void pauseRequiresCommandKeyAndSignedSession() throws Exception {
        String body = "{\"expectedVersion\":1}";
        String path = "/focus-sessions/" + FOCUS + "/pause";
        mockMvc.perform(auth(post(path)).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(post(path).header("Idempotency-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(write(post("/focus-sessions/1-2-3-4-5/pause"), body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.field").value("sessionId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"409,SESSION_IN_PROGRESS,409,STATE_CONFLICT,",
            "403,ISLAND_NOT_CURRENT,403,FORBIDDEN,islandId",
            "400,INVALID_TARGET_MINUTES,400,INVALID_PARAMETER,targetMinutes",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,ISLAND_NOT_CURRENT,502,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_FOCUS_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_START, request -> error(upstreamStatus, code));
        var result = mockMvc.perform(write(post("/focus-sessions"), START_BODY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    /** 보상 정책 게이트가 닫혀 있는 동안 finish 는 재시도 가능한 503 이다 — 「0원 지급 성공」이 아니다. */
    @Test
    void finishRelaysClosedRewardGateAsRetryableUnavailable() throws Exception {
        DATA.on("POST " + INTERNAL + "/focus-sessions/" + FOCUS + "/finish",
                request -> error(503, "REWARD_POLICY_UNAVAILABLE"));
        mockMvc.perform(write(post("/focus-sessions/" + FOCUS + "/finish"), "{\"expectedVersion\":3}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.retryable").value(true))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY)
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}

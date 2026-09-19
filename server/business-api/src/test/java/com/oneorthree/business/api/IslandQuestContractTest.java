package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 퀘스트 공개 5종의 계약 (GROMO-1773) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>판정·지급의 원자성은 data-api 의 {@code IslandQuestIntegrationTest} 가 본다. 여기서 보는 것은 경계다:
 * 주체를 무엇으로 정하는가, 본문을 어느 모양까지 받는가, 어떤 상류 실패만 공개 오류로 옮기는가.
 */
class IslandQuestContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1773-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1773-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1773-0000-0000-000000000001");
    private static final UUID QUEST = UUID.fromString("dddddddd-1773-0000-0000-000000000001");
    private static final UUID OCCURRENCE = UUID.fromString("eeeeeeee-1773-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("ffffffff-1773-0000-0000-000000000001");
    private static final String KEY = "12345678-1773-5000-8000-000000000001";

    private static final String INTERNAL = "/internal/islands/" + ISLAND + "/quests";
    private static final String DATA_CURRENT = "GET " + INTERNAL + "/current";
    private static final String DATA_PROGRESS = "GET " + INTERNAL + "/" + QUEST + "/progress";
    private static final String DATA_CREATE = "POST " + INTERNAL;
    private static final String DATA_UPDATE = "PATCH " + INTERNAL + "/" + QUEST;
    private static final String DATA_CLAIM = "POST " + INTERNAL + "/" + QUEST + "/claims";

    private static final String PUBLIC = "/islands/" + ISLAND + "/quests";

    private static final String HEADER = "\"id\":\"" + QUEST + "\",\"occurrenceId\":\"" + OCCURRENCE + "\","
            + "\"title\":\"저녁 30분 집중\",\"type\":\"focus\",\"windowStart\":\"18:00\",\"windowEnd\":\"23:00\","
            + "\"timezone\":\"UTC\",\"date\":\"2026-09-19\",\"targetMinutes\":30,\"myRate\":60,"
            + "\"reward\":{\"currency\":\"village_points\",\"amount\":30},\"settlementStatus\":\"in_progress\","
            + "\"claimable\":false,\"claimBlockedReason\":\"MEMBERS_INCOMPLETE\",\"claimed\":false,\"version\":1";
    private static final String CURRENT_BODY = "{\"items\":[{" + HEADER + "}]}";
    private static final String PROGRESS_BODY = "{" + HEADER + ",\"members\":[{\"userId\":\"" + USER
            + "\",\"name\":\"수빈\",\"rate\":60,\"measurementStatus\":\"authorized\"},{\"userId\":\"" + OTHER
            + "\",\"name\":null,\"rate\":null,\"measurementStatus\":\"unavailable\"}],\"nextCursor\":null}";
    private static final String CREATED_BODY = "{\"id\":\"" + QUEST + "\",\"title\":\"저녁 30분 집중\"}";
    private static final String UPDATED_BODY = "{\"id\":\"" + QUEST + "\",\"title\":\"저녁 40분 집중\",\"targetMinutes\":40}";
    private static final String CLAIMED_BODY = "{\"claimId\":\"" + OTHER + "\",\"occurrenceId\":\"" + OCCURRENCE
            + "\",\"villagePointsAdded\":30,\"claimed\":true}";
    private static final String CLAIM_REQUEST = "{\"occurrenceId\":\"" + OCCURRENCE + "\",\"expectedVersion\":1}";
    private static final String CREATE_REQUEST = "{\"title\":\"저녁 30분 집중\",\"type\":\"focus\",\"targetMinutes\":30,"
            + "\"windowStart\":\"18:00\",\"windowEnd\":\"23:00\",\"timezone\":\"UTC\"}";

    // ---------------------------------------------------------------- 주체

    @Test
    @DisplayName("주체는 서명된 세션에서만 오고 공격자가 넣은 X-User-Id 는 버려진다 — 키와 본문은 그대로 옮긴다")
    void forwardsOnlyTheSignedSubject() throws Exception {
        DATA.on(DATA_CLAIM, request -> ok(CLAIMED_BODY));

        mockMvc.perform(write(post(PUBLIC + "/" + QUEST + "/claims"), CLAIM_REQUEST)
                        .header("X-User-Id", OTHER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.claimed").value(true))
                .andExpect(jsonPath("$.data.villagePointsAdded").value(30));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_CLAIM).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.body()).isEqualTo(CLAIM_REQUEST);
    }

    // ---------------------------------------------------------------- 정상 경로

    @Test
    @DisplayName("GET current 는 상류 항목을 그대로 내리고 UTC 축·보상·판정 필드를 담는다")
    void currentPassesThroughItems() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok(CURRENT_BODY));

        mockMvc.perform(auth(get(PUBLIC + "/current")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].id").value(QUEST.toString()))
                .andExpect(jsonPath("$.data.items[0].timezone").value("UTC"))
                .andExpect(jsonPath("$.data.items[0].reward.currency").value("village_points"))
                .andExpect(jsonPath("$.data.items[0].reward.amount").value(30))
                .andExpect(jsonPath("$.data.items[0].claimBlockedReason").value("MEMBERS_INCOMPLETE"))
                .andExpect(jsonPath("$.data.items[0].version").value(1));
        assertThat(DATA.receivedFor(DATA_CURRENT).get(0).query()).isNull();
    }

    @Test
    @DisplayName("GET progress 는 occurrenceId 만 질의로 옮기고 주민 목록·nextCursor 를 내린다")
    void progressForwardsOccurrenceOnly() throws Exception {
        DATA.on(DATA_PROGRESS, request -> ok(PROGRESS_BODY));

        mockMvc.perform(auth(get(PUBLIC + "/" + QUEST + "/progress").param("occurrenceId", OCCURRENCE.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.occurrenceId").value(OCCURRENCE.toString()))
                .andExpect(jsonPath("$.data.members[0].measurementStatus").value("authorized"))
                .andExpect(jsonPath("$.data.members[1].measurementStatus").value("unavailable"))
                .andExpect(jsonPath("$.data.members.length()").value(2));
        assertThat(DATA.receivedFor(DATA_PROGRESS).get(0).query()).isEqualTo("occurrenceId=" + OCCURRENCE);
    }

    @Test
    @DisplayName("progress 응답의 대상이 요청과 다르면 502 다")
    void progressForAnotherOccurrenceIsAContractError() throws Exception {
        DATA.on(DATA_PROGRESS, request -> ok(PROGRESS_BODY));

        mockMvc.perform(auth(get(PUBLIC + "/" + QUEST + "/progress").param("occurrenceId", OTHER.toString())))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("POST 생성은 201 이고 허용 필드만 상류로 옮긴다")
    void createReturns201() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(CREATED_BODY));

        mockMvc.perform(write(post(PUBLIC), CREATE_REQUEST))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(QUEST.toString()))
                .andExpect(jsonPath("$.data.title").value("저녁 30분 집중"));
        assertThat(DATA.receivedFor(DATA_CREATE).get(0).body()).isEqualTo(CREATE_REQUEST);
    }

    @Test
    @DisplayName("screen 생성은 창 필드 없이 timezone 생략도 받는다")
    void createScreenWithoutWindow() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(CREATED_BODY));

        mockMvc.perform(write(post(PUBLIC), "{\"title\":\"폰 1시간\",\"type\":\"screen\",\"targetMinutes\":60}"))
                .andExpect(status().isCreated());
        assertThat(DATA.receivedFor(DATA_CREATE).get(0).body()).contains("\"type\":\"screen\"")
                .contains("\"targetMinutes\":60");
    }

    @Test
    @DisplayName("PATCH 는 넘긴 필드만 옮기고 200 id/title/targetMinutes 다")
    void updatePassesThroughPartialBody() throws Exception {
        DATA.on(DATA_UPDATE, request -> ok(UPDATED_BODY));

        mockMvc.perform(write(patch(PUBLIC + "/" + QUEST), "{\"targetMinutes\":40}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.targetMinutes").value(40));
        assertThat(DATA.receivedFor(DATA_UPDATE).get(0).body()).contains("\"targetMinutes\":40");
    }

    @Test
    @DisplayName("claimed=false 를 주는 정산 응답은 계약 불일치 502 다")
    void unclaimedSuccessIsAContractError() throws Exception {
        DATA.on(DATA_CLAIM, request -> ok(CLAIMED_BODY.replace("\"claimed\":true", "\"claimed\":false")));

        mockMvc.perform(write(post(PUBLIC + "/" + QUEST + "/claims"), CLAIM_REQUEST))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 오류 표

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "403,QUEST_FORBIDDEN,403,FORBIDDEN,",
            "403,QUEST_BOARD_LOCKED,403,FACILITY_LOCKED,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "404,QUEST_NOT_FOUND,404,NOT_FOUND,questId",
            "404,QUEST_OCCURRENCE_NOT_FOUND,404,NOT_FOUND,occurrenceId",
            "400,QUEST_INVALID_REQUEST,400,INVALID_REQUEST,",
            "409,QUEST_VERSION_CONFLICT,409,VERSION_CONFLICT,expectedVersion",
            "409,QUEST_STATE_CONFLICT,409,STATE_CONFLICT,occurrenceId",
            "503,QUEST_SETTLEMENT_UNAVAILABLE,503,SERVICE_UNAVAILABLE,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,QUEST_FORBIDDEN,502,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_QUEST_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("claim — 정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 502 다")
    void claimMapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_CLAIM, request -> error(upstreamStatus, code));

        MvcResult result = mockMvc.perform(write(post(PUBLIC + "/" + QUEST + "/claims"), CLAIM_REQUEST))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    @ParameterizedTest
    @CsvSource({"422,QUEST_TITLE_OUT_OF_RANGE,422,OUT_OF_RANGE,title",
            "422,QUEST_TARGET_OUT_OF_RANGE,422,OUT_OF_RANGE,targetMinutes",
            "422,QUEST_WINDOW_OUT_OF_RANGE,422,OUT_OF_RANGE,windowEnd",
            "400,QUEST_INVALID_TIMEZONE,400,INVALID_PARAMETER,timezone",
            "403,QUEST_FORBIDDEN,403,FORBIDDEN,",
            "503,QUEST_CREATION_UNAVAILABLE,503,SERVICE_UNAVAILABLE,"})
    @DisplayName("생성 — 범위 위반은 필드를 지목한 422, 생성 스위치가 닫히면 503 이다")
    void createMapsRangeAndGate(int upstreamStatus, String code, int publicStatus, String publicCode, String field)
            throws Exception {
        DATA.on(DATA_CREATE, request -> error(upstreamStatus, code));

        mockMvc.perform(write(post(PUBLIC), CREATE_REQUEST))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    @Test
    @DisplayName("REQUEST_IN_PROGRESS 는 상류의 Retry-After 를 보존한 채 409 로 나간다")
    void requestInProgressPreservesRetryAfter() throws Exception {
        DATA.on(DATA_CLAIM, request -> new MockUpstream.Response(409,
                "{\"code\":\"REQUEST_IN_PROGRESS\",\"message\":\"private detail\",\"retryAfterMs\":1000}"));

        mockMvc.perform(write(post(PUBLIC + "/" + QUEST + "/claims"), CLAIM_REQUEST))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REQUEST_IN_PROGRESS"))
                .andExpect(header().string("Retry-After", "1"));
    }

    // ---------------------------------------------------------------- 입력 거절

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]",
            "{\"title\":\"x\",\"type\":\"focus\",\"targetMinutes\":30,\"windowStart\":\"18:00\"}",
            "{\"title\":\"x\",\"type\":\"focus\",\"targetMinutes\":30,\"windowStart\":\"18:00\",\"windowEnd\":\"24:00\"}",
            "{\"title\":\"x\",\"type\":\"focus\",\"targetMinutes\":30,\"windowStart\":\"6:00\",\"windowEnd\":\"23:00\"}",
            "{\"title\":\"x\",\"type\":\"screen\",\"targetMinutes\":60,\"windowStart\":\"18:00\"}",
            "{\"title\":\"x\",\"type\":\"screen\",\"targetMinutes\":60.5}",
            "{\"title\":\"x\",\"type\":\"screen\",\"targetMinutes\":\"60\"}",
            "{\"title\":null,\"type\":\"screen\",\"targetMinutes\":60}",
            "{\"title\":\"x\",\"type\":\"screen\",\"targetMinutes\":60,\"timezone\":null}",
            "{\"title\":\"x\",\"type\":\"screen\",\"targetMinutes\":60,\"repeat\":\"daily\"}"})
    @DisplayName("생성 본문 모양이 어긋나면 네트워크 전에 400 이다")
    void rejectsMalformedCreateBody(String body) throws Exception {
        mockMvc.perform(write(post(PUBLIC), body)).andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("UTC 가 아닌 timezone 은 400 INVALID_PARAMETER, 모르는 type 은 422 다")
    void rejectsNonUtcTimezoneAndUnknownType() throws Exception {
        mockMvc.perform(write(post(PUBLIC), CREATE_REQUEST.replace("\"UTC\"", "\"Asia/Seoul\"")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("timezone"));
        mockMvc.perform(write(post(PUBLIC), CREATE_REQUEST.replace("\"focus\"", "\"steps\"")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("type"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"title\":null}", "{\"targetMinutes\":1.5}", "{\"type\":\"screen\"}",
            "{\"windowStart\":\"10:00\"}"})
    @DisplayName("PATCH 는 title/targetMinutes 중 하나 이상 — null·새 type·창 키는 400 이다")
    void rejectsMalformedPatch(String body) throws Exception {
        mockMvc.perform(write(patch(PUBLIC + "/" + QUEST), body)).andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"occurrenceId\":\"" + "x" + "\",\"expectedVersion\":1}",
            "{\"occurrenceId\":\"eeeeeeee-1773-0000-0000-000000000001\"}",
            "{\"occurrenceId\":\"eeeeeeee-1773-0000-0000-000000000001\",\"expectedVersion\":\"1\"}",
            "{\"occurrenceId\":\"eeeeeeee-1773-0000-0000-000000000001\",\"expectedVersion\":1,\"amount\":999}"})
    @DisplayName("claim 본문은 정확히 {occurrenceId, expectedVersion} — 지급량 주입도 여기서 막힌다")
    void rejectsMalformedClaim(String body) throws Exception {
        mockMvc.perform(write(post(PUBLIC + "/" + QUEST + "/claims"), body)).andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("claim 의 expectedVersion 0 은 422 — 버전은 1부터다")
    void zeroVersionIsOutOfRange() throws Exception {
        mockMvc.perform(write(post(PUBLIC + "/" + QUEST + "/claims"),
                        CLAIM_REQUEST.replace("\"expectedVersion\":1", "\"expectedVersion\":0")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("expectedVersion"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("progress 는 occurrenceId 가 필수이고 cursor 는 발급한 적이 없어 무엇이든 400 이다")
    void progressQueryRules() throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/" + QUEST + "/progress")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("occurrenceId"));
        mockMvc.perform(auth(get(PUBLIC + "/" + QUEST + "/progress").param("occurrenceId", "nope")))
                .andExpect(status().isBadRequest());
        mockMvc.perform(auth(get(PUBLIC + "/" + QUEST + "/progress")
                        .param("occurrenceId", OCCURRENCE.toString()).param("cursor", "abc")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("쓰기는 UUID 멱등키 하나와 서명 세션을 요구한다")
    void writesRequireKeyAndSession() throws Exception {
        mockMvc.perform(auth(post(PUBLIC + "/" + QUEST + "/claims"))
                        .contentType(MediaType.APPLICATION_JSON).content(CLAIM_REQUEST))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(post(PUBLIC).header("Idempotency-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(CREATE_REQUEST))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(PUBLIC + "/current").header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}

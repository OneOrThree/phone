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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 건설 공개 3종의 계약 (GROMO-1767) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>상류의 원자 변경은 data-api 쪽 통합 테스트가 본다. 여기서 보는 것은 경계다: 주체를 무엇으로
 * 정하는가, 본문을 어느 모양까지 받는가, 어떤 상류 실패만 공개 오류로 옮기는가, 버전 충돌의
 * current 를 어떻게 채우는가.
 */
class IslandConstructionContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1767-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1767-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1767-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("dddddddd-1767-0000-0000-000000000001");
    private static final String KEY = "eeeeeeee-1767-5000-8000-000000000001";

    private static final String INTERNAL = "/internal/islands/" + ISLAND;
    private static final String DATA_OPTIONS = "GET " + INTERNAL + "/construction-options";
    private static final String DATA_TARGET = "PUT " + INTERNAL + "/construction-target";
    private static final String DATA_BUILD = "POST " + INTERNAL + "/constructions";

    private static final String OPTIONS_BODY = "{\"islandVersion\":4,\"costPolicyVersion\":1,"
            + "\"selectedBuildingId\":\"gram\",\"villagePoints\":150,\"walletVersion\":7,"
            + "\"items\":[{\"id\":\"gram\",\"name\":\"꽃나팔 방송기\",\"cost\":1360,"
            + "\"currency\":\"village_points\",\"selectable\":true,\"buildable\":true,"
            + "\"blockedReason\":null}]}";
    private static final String TARGET_BODY = "{\"buildingId\":\"gram\",\"selected\":true,"
            + "\"spent\":0,\"version\":5}";
    private static final String BUILD_BODY = "{\"buildingId\":\"gram\",\"status\":\"BUILDING\","
            + "\"spent\":{\"currency\":\"village_points\",\"amount\":1360},\"version\":5,"
            + "\"villagePoints\":50,\"walletVersion\":8,"
            + "\"startedAt\":\"2026-09-18T10:00:00+09:00\",\"completesAt\":\"2026-09-18T10:30:00+09:00\"}";

    // ---------------------------------------------------------------- 주체

    @Test
    @DisplayName("주체는 서명된 세션에서만 오고 공격자가 넣은 X-User-Id 는 버려진다")
    void forwardsOnlyTheSignedSubjectAndNeverTheAttackerHeader() throws Exception {
        DATA.on(DATA_BUILD, request -> ok(BUILD_BODY));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}")
                        .header("X-User-Id", OTHER)
                        .header("X-Service-Token", "stolen"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.buildingId").value("gram"))
                .andExpect(jsonPath("$.data.status").value("BUILDING"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_BUILD).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Authorization")).isEqualTo("Bearer ci-token-data");
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.header("X-Service-Token")).isNull();
        assertThat(forwarded.body()).isEqualTo(
                "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}");
    }

    // ---------------------------------------------------------------- 정상 경로

    @Test
    @DisplayName("GET 옵션은 상류 스냅샷을 그대로 벗겨 내리고 세 버전 축을 모두 담는다")
    void optionsPassesThroughAllThreeVersionAxes() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(OPTIONS_BODY));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/construction-options")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.islandVersion").value(4))
                .andExpect(jsonPath("$.data.costPolicyVersion").value(1))
                .andExpect(jsonPath("$.data.walletVersion").value(7))
                .andExpect(jsonPath("$.data.selectedBuildingId").value("gram"))
                .andExpect(jsonPath("$.data.villagePoints").value(150))
                .andExpect(jsonPath("$.data.items[0].id").value("gram"))
                .andExpect(jsonPath("$.data.items[0].blockedReason").doesNotExist());

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_OPTIONS).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.query()).as("조회에는 질의 문자열이 없다").isNull();
    }

    @Test
    @DisplayName("PUT 목표 선택은 차감 없는 2키 본문을 상류로 옮긴다")
    void targetPutForwardsTwoFieldBody() throws Exception {
        DATA.on(DATA_TARGET, request -> ok(TARGET_BODY));

        mockMvc.perform(write(put("/islands/" + ISLAND + "/construction-target"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.buildingId").value("gram"))
                .andExpect(jsonPath("$.data.selected").value(true))
                .andExpect(jsonPath("$.data.spent").value(0))
                .andExpect(jsonPath("$.data.version").value(5));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_TARGET).get(0);
        assertThat(forwarded.body()).isEqualTo("{\"buildingId\":\"gram\",\"expectedVersion\":4}");
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
    }

    @Test
    @DisplayName("POST 건설은 BUILDING 상태와 startedAt/completesAt 를 그대로 내린다")
    void buildReturnsBuildingStatusWithSchedule() throws Exception {
        DATA.on(DATA_BUILD, request -> ok(BUILD_BODY));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("BUILDING"))
                .andExpect(jsonPath("$.data.spent.currency").value("village_points"))
                .andExpect(jsonPath("$.data.spent.amount").value(1360))
                .andExpect(jsonPath("$.data.walletVersion").value(8))
                .andExpect(jsonPath("$.data.startedAt").isNotEmpty())
                .andExpect(jsonPath("$.data.completesAt").isNotEmpty());
    }

    @Test
    @DisplayName("BUILDING 이 아닌 상태를 주는 상류 응답은 계약 불일치로 400 다")
    void nonBuildingStatusIsAContractError() throws Exception {
        DATA.on(DATA_BUILD, request -> ok(BUILD_BODY.replace("\"BUILDING\"", "\"completed\"")));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 버전 충돌의 current

    @Test
    @DisplayName("expectedVersion 불일치는 409+current 이며 field 는 expectedVersion 이다")
    void islandVersionConflictCarriesCurrentSnapshot() throws Exception {
        DATA.on(DATA_BUILD, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_OPTIONS, request -> ok(OPTIONS_BODY));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":3,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("expectedVersion"))
                .andExpect(jsonPath("$.current.version").value(4))
                .andExpect(jsonPath("$.current.resource.islandVersion").value(4))
                .andExpect(jsonPath("$.current.resource.villagePoints").value(150));

        // current 재조회는 같은 세션 주체로 내부 GET 을 한 번 더 부른다.
        assertThat(DATA.receivedFor(DATA_OPTIONS)).hasSize(1);
        assertThat(DATA.receivedFor(DATA_OPTIONS).get(0).header("X-User-Id"))
                .isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("섬 버전이 맞고 가격 버전만 어긋나면 field 는 expectedCostPolicyVersion 이다")
    void costPolicyVersionConflictIsNamedInField() throws Exception {
        DATA.on(DATA_BUILD, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_OPTIONS, request -> ok(OPTIONS_BODY));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":99}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("expectedCostPolicyVersion"))
                .andExpect(jsonPath("$.current.version").value(4));
    }

    @Test
    @DisplayName("PUT 의 버전 충돌도 current 를 달고 field 는 언제나 expectedVersion 이다")
    void targetConflictAlsoCarriesCurrent() throws Exception {
        DATA.on(DATA_TARGET, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_OPTIONS, request -> ok(OPTIONS_BODY));

        mockMvc.perform(write(put("/islands/" + ISLAND + "/construction-target"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("expectedVersion"))
                .andExpect(jsonPath("$.current.resource.selectedBuildingId").value("gram"));
    }

    @Test
    @DisplayName("current 재조회마저 실패하면 충돌은 current 없이 나간다")
    void failedRefetchDropsCurrentButKeepsTheConflict() throws Exception {
        DATA.on(DATA_TARGET, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_OPTIONS, request -> error(403, "MEMBER_ONLY"));

        mockMvc.perform(write(put("/islands/" + ISLAND + "/construction-target"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":3}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.current").doesNotExist());
    }

    // ---------------------------------------------------------------- 오류 표

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "403,FACILITY_LOCKED,403,FACILITY_LOCKED,",
            "403,CONSTRUCTION_FORBIDDEN,403,FORBIDDEN,",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "400,INVALID_REQUEST,400,INVALID_REQUEST,",
            "409,STATE_CONFLICT,409,STATE_CONFLICT,buildingId",
            "409,INSUFFICIENT_FUNDS,409,INSUFFICIENT_FUNDS,buildingId",
            "422,OUT_OF_RANGE,422,OUT_OF_RANGE,buildingId",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,MEMBER_ONLY,400,UPSTREAM_CONTRACT_ERROR,",
            "403,STATE_CONFLICT,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_CONSTRUCTION_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 400 다")
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_TARGET, request -> error(upstreamStatus, code));

        MvcResult result = mockMvc.perform(write(put("/islands/" + ISLAND + "/construction-target"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4}"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString())
                .as("상류의 내부 문구가 공개 응답에 새지 않는다").doesNotContain("private detail");
    }

    @Test
    @DisplayName("REQUEST_IN_PROGRESS 는 상류의 Retry-After 를 보존한 채 409 로 나간다")
    void requestInProgressPreservesUpstreamRetryAfter() throws Exception {
        DATA.on(DATA_BUILD, request -> new MockUpstream.Response(409,
                "{\"code\":\"REQUEST_IN_PROGRESS\",\"message\":\"private detail\",\"retryAfterMs\":1000}"));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REQUEST_IN_PROGRESS"))
                .andExpect(jsonPath("$.error.retryable").value(true))
                .andExpect(header().string("Retry-After", "1"));
    }

    // ---------------------------------------------------------------- 입력 거절

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "\"x\"",
            "{\"buildingId\":\"gram\"}",
            "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"extra\":1}",
            "{\"buildingId\":123,\"expectedVersion\":4}",
            "{\"buildingId\":\"gram\",\"expectedVersion\":\"4\"}",
            "{\"buildingId\":\"gram\",\"expectedVersion\":4.5}"})
    @DisplayName("PUT 본문 모양이 어긋나면 네트워크 전에 400 이다")
    void rejectsMalformedTargetBodyBeforeTheNetwork(String body) throws Exception {
        DATA.on(DATA_TARGET, request -> ok(TARGET_BODY));

        mockMvc.perform(write(put("/islands/" + ISLAND + "/construction-target"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"buildingId\":\"gram\",\"expectedVersion\":4}",
            "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":\"1\"}",
            "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1,\"cost\":100}"})
    @DisplayName("POST 는 expectedCostPolicyVersion 까지 3키를 요구한다 — cost 주입도 여기서 막힌다")
    void postRequiresExactlyThreeBodyKeys(String body) throws Exception {
        DATA.on(DATA_BUILD, request -> ok(BUILD_BODY));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("빈 buildingId 와 과도한 길이는 422, 안전 정수를 넘는 버전도 422 다")
    void outOfRangeInputsAreUnprocessable() throws Exception {
        DATA.on(DATA_BUILD, request -> ok(BUILD_BODY));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"  \",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("buildingId"));
        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"" + "x".repeat(41)
                                + "\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("buildingId"));
        mockMvc.perform(write(post("/islands/" + ISLAND + "/constructions"),
                        "{\"buildingId\":\"gram\",\"expectedVersion\":-1,\"expectedCostPolicyVersion\":1}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("expectedVersion"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("쓰기는 UUID 멱등키 하나와 서명 세션을 요구한다")
    void writesRequireOneUuidKeyAndASignedSession() throws Exception {
        DATA.on(DATA_BUILD, request -> ok(BUILD_BODY));
        String body = "{\"buildingId\":\"gram\",\"expectedVersion\":4,\"expectedCostPolicyVersion\":1}";

        mockMvc.perform(auth(post("/islands/" + ISLAND + "/constructions"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(post("/islands/" + ISLAND + "/constructions")
                        .header("Idempotency-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/islands/" + ISLAND + "/construction-options")
                        .header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("경로의 islandId 가 UUID 가 아니면 400 이고 상류를 부르지 않는다")
    void malformedIslandIdNeverReachesUpstream() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(OPTIONS_BODY));

        mockMvc.perform(auth(get("/islands/not-a-uuid/construction-options")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }

    // ---------------------------------------------------------------- 도구

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
        return new MockUpstream.Response(status,
                "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}

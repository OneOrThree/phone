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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 소속·탐색 공개 6종의 계약 (GROMO-1759) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>상류의 원자 변경은 data-api 의 {@code IslandMembershipIntegrationTest} 가 본다. 여기서 보는 것은
 * <b>경계</b> 다: 주체를 무엇으로 정하는가, 범위 봉투를 어떻게 벗기는가, 어떤 상류 실패만 공개
 * 오류로 옮기는가, 커서가 필터에 묶여 있는가.
 */
class IslandMembershipContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1759-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1759-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1759-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("dddddddd-1759-0000-0000-000000000001");
    private static final String KEY = "eeeeeeee-1759-5000-8000-000000000001";

    private static final String INTERNAL = "/internal/users/" + USER;
    private static final String DATA_CREATE = "POST " + INTERNAL + "/islands";
    private static final String DATA_MINE = "GET " + INTERNAL + "/islands";
    private static final String DATA_SEARCH = "GET " + INTERNAL + "/island-search";
    private static final String DATA_DISCOVER = "GET " + INTERNAL + "/island-discovery";
    private static final String DATA_SWITCH = "PUT " + INTERNAL + "/current-island";
    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_MY_REQUESTS = "GET " + INTERNAL + "/join-requests";

    private static final UUID REQUEST = UUID.fromString("ffffffff-2047-0000-0000-000000000001");
    private static final String MY_REQUEST_ITEM = "{\"id\":\"" + REQUEST + "\",\"islandId\":\"" + ISLAND
            + "\",\"islandName\":\"모래섬\",\"memberCount\":3,\"maxMembers\":15,\"status\":\"pending\","
            + "\"version\":1,\"createdAt\":\"2026-09-19T01:02:03Z\"}";

    private static final String CREATE_BODY = "{\"name\":\"모래섬\",\"approvalRequired\":false}";
    private static final String CREATED = "{\"id\":\"" + ISLAND + "\",\"membershipStatus\":\"active\","
            + "\"role\":\"host\",\"currentIslandId\":\"" + ISLAND + "\"}";
    private static final String SUMMARY = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\","
            + "\"visibility\":\"public\",\"approvalRequired\":false,\"memberCount\":1,\"maxMembers\":15,"
            + "\"membershipStatus\":\"none\",\"joinRequestId\":null,"
            + "\"growthStage\":null,\"themeId\":null}";
    private static final String DETAIL = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\","
            + "\"visibility\":\"public\",\"approvalRequired\":false,\"memberCount\":1,\"maxMembers\":15,"
            + "\"membershipStatus\":\"active\",\"growthStage\":null,\"themeId\":null,"
            + "\"role\":\"host\",\"version\":3}";

    // ---------------------------------------------------------------- 주체

    @Test
    @DisplayName("주체는 서명된 세션에서만 오고 공격자가 넣은 X-User-Id 는 버려진다")
    void forwardsOnlyTheSignedSubjectAndNeverTheAttackerHeader() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(CREATED));

        mockMvc.perform(write(post("/islands"), CREATE_BODY)
                        .header("X-User-Id", OTHER)
                        .header("X-Service-Token", "stolen"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.role").value("host"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_CREATE).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Authorization")).isEqualTo("Bearer ci-token-data");
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.header("X-Service-Token")).isNull();
        assertThat(forwarded.body()).isEqualTo(
                "{\"name\":\"모래섬\",\"intro\":null,\"approvalRequired\":false,\"maxMembers\":null}");
    }

    // ---------------------------------------------------------------- 범위 봉투

    @Test
    @DisplayName("주민 상세는 판별자 없이 그대로 내려가고 방문자 요약은 주민 필드를 갖지 않는다")
    void scopeEnvelopeIsUnwrappedWithoutLeakingItsDiscriminator() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":"
                + DETAIL + "}"));
        mockMvc.perform(auth(get("/islands/" + ISLAND)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.role").value("host"))
                .andExpect(jsonPath("$.data.version").value(3))
                .andExpect(jsonPath("$.data.scope").doesNotExist())
                .andExpect(jsonPath("$.data.member").doesNotExist())
                .andExpect(jsonPath("$.data.visitor").doesNotExist());

        DATA.reset();
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"visitor\",\"visitor\":" + SUMMARY
                + ",\"member\":null}"));
        mockMvc.perform(auth(get("/islands/" + ISLAND)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.membershipStatus").value("none"))
                // 결정 V-읽기 — 방문자도 「주민 수/정원」을 한 쌍으로 본다. 주민 전용은 role·version 이다.
                .andExpect(jsonPath("$.data.memberCount").value(1))
                .andExpect(jsonPath("$.data.maxMembers").value(15))
                .andExpect(jsonPath("$.data.role").doesNotExist())
                .andExpect(jsonPath("$.data.version").doesNotExist())
                .andExpect(jsonPath("$.data.scope").doesNotExist());
    }

    @Test
    @DisplayName("범위를 요청이 고를 수 없다 — role·isMember 쿼리는 상류로 새지 않는다")
    void requestCannotChooseItsOwnScope() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"visitor\",\"visitor\":" + SUMMARY
                + ",\"member\":null}"));

        mockMvc.perform(auth(get("/islands/" + ISLAND))
                        .param("role", "host").param("isMember", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.role").doesNotExist());

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_ISLAND).get(0);
        // 상세 호출은 질의 문자열 자체가 없어야 한다 — null 이 정상이고, 값이 있다면 조작 키가 없어야 한다.
        String query = forwarded.query() == null ? "" : forwarded.query();
        assertThat(query).as("조작 파라미터를 상류로 넘기지 않는다")
                .doesNotContain("role").doesNotContain("isMember");
    }

    @Test
    @DisplayName("판별자와 알맹이가 어긋난 상류 응답은 502 다")
    void inconsistentScopeEnvelopeIsAContractError() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":" + SUMMARY
                + ",\"member\":null}"));

        mockMvc.perform(auth(get("/islands/" + ISLAND)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ---------------------------------------------------------------- 경로 분기

    @Test
    @DisplayName("/islands/discover 는 상세 경로가 아니라 자기 상류로 간다")
    void discoverNeverFallsIntoTheDetailRoute() throws Exception {
        DATA.on(DATA_DISCOVER, request -> ok("{\"items\":[" + SUMMARY + "],\"nextHandle\":null}"));

        mockMvc.perform(auth(get("/islands/discover")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(1))
                .andExpect(jsonPath("$.data.nextCursor").doesNotExist());

        assertThat(DATA.hits(DATA_DISCOVER)).isEqualTo(1);
        assertThat(DATA.hits("GET /internal/islands/discover")).isZero();
        assertThat(DATA.receivedFor(DATA_DISCOVER).get(0).query())
                .as("발견 기본 limit 은 1 이다").contains("limit=1");
    }

    @Test
    @DisplayName("내 섬 목록은 페이지가 없으므로 nextCursor 가 항상 null 이다")
    void myIslandsAlwaysReportsANullCursor() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[" + SUMMARY + "],\"currentIslandId\":\""
                + ISLAND + "\"}"));

        mockMvc.perform(auth(get("/me/islands")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentIslandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.data.items.length()").value(1));
    }

    @Test
    @DisplayName("현재 섬이 없는 정상 응답은 null 로 통과하고 빈 본문만 502 다")
    void nullCurrentIslandPassesButAnEmptyBodyDoesNot() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));
        mockMvc.perform(auth(get("/me/islands")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.currentIslandId").doesNotExist());

        DATA.reset();
        DATA.on(DATA_MINE, request -> new MockUpstream.Response(200, ""));
        mockMvc.perform(auth(get("/me/islands")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("현재 섬이 없는 이유는 그대로 미러하고, 없는 이유가 없으면 키도 없다")
    void lossReasonMirrorsUpstream() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null,"
                + "\"lossReason\":\"KICKED\"}"));
        mockMvc.perform(auth(get("/me/islands")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentIslandId").doesNotExist())
                .andExpect(jsonPath("$.data.lossReason").value("KICKED"));

        DATA.reset();
        // 이 키를 «모르는» Data 가 붙어도 통과해야 한다 — 두 서비스는 따로 배포된다.
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));
        mockMvc.perform(auth(get("/me/islands")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.lossReason").doesNotExist());
    }

    @Test
    @DisplayName("현재 섬이 있는데 상실 사유가 함께 오면 502 다 — V84 의 CHECK 와 같은 불변식")
    void aCurrentIslandWithALossReasonIsAContractViolation() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[" + SUMMARY + "],\"currentIslandId\":\""
                + ISLAND + "\",\"lossReason\":\"LEFT\"}"));

        mockMvc.perform(auth(get("/me/islands")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

    // ---------------------------------------------------------------- 내 가입 신청 목록

    @Test
    @DisplayName("내 신청 목록 — 섬 요약(이름·주민 수·정원)과 상태·신청 시각이 실리고, 경계는 서명 커서로 감싼다")
    void myJoinRequestsCarryTheIslandSummaryAndASignedCursor() throws Exception {
        DATA.on(DATA_MY_REQUESTS, request -> ok("{\"items\":[" + MY_REQUEST_ITEM + "],"
                + "\"nextCreatedAt\":\"2026-09-19T01:02:03Z\",\"nextRequestId\":\"" + REQUEST + "\"}"));

        MvcResult first = mockMvc.perform(auth(get("/me/join-requests")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].id").value(REQUEST.toString()))
                .andExpect(jsonPath("$.data.items[0].islandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.items[0].islandName").value("모래섬"))
                .andExpect(jsonPath("$.data.items[0].memberCount").value(3))
                .andExpect(jsonPath("$.data.items[0].maxMembers").value(15))
                .andExpect(jsonPath("$.data.items[0].status").value("pending"))
                .andExpect(jsonPath("$.data.items[0].createdAt").value("2026-09-19T01:02:03Z"))
                .andExpect(jsonPath("$.data.nextCreatedAt").doesNotExist())
                .andExpect(jsonPath("$.data.nextCursor").isNotEmpty()).andReturn();
        assertThat(DATA.receivedFor(DATA_MY_REQUESTS).get(0).query())
                .as("기본 limit 은 20 이고 첫 페이지는 경계를 싣지 않는다")
                .contains("limit=20").doesNotContain("afterCreatedAt");

        String cursor = com.jayway.jsonpath.JsonPath.read(
                first.getResponse().getContentAsString(), "$.data.nextCursor");
        mockMvc.perform(auth(get("/me/join-requests")).param("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_MY_REQUESTS).get(1).query())
                .contains("afterRequestId=" + REQUEST).contains("afterCreatedAt=2026-09-19T01");

        // limit 이 바뀌면 같은 커서를 못 쓴다 — 다른 목록과 같은 규칙이다.
        int before = DATA.hits(DATA_MY_REQUESTS);
        mockMvc.perform(auth(get("/me/join-requests")).param("cursor", cursor).param("limit", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.hits(DATA_MY_REQUESTS)).isEqualTo(before);
    }

    @Test
    @DisplayName("내 신청 목록 — 신청이 없으면 빈 목록 + 200 이고, 단건 조회 경로와 겹치지 않는다")
    void myJoinRequestsAreEmptyRatherThanNotFound() throws Exception {
        DATA.on(DATA_MY_REQUESTS, request -> ok("{\"items\":[],\"nextCreatedAt\":null,"
                + "\"nextRequestId\":null}"));

        mockMvc.perform(auth(get("/me/join-requests")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty())
                .andExpect(jsonPath("$.data.nextCursor").doesNotExist());

        // 단건은 여전히 §3.8 상류로 간다 — 목록 경로가 삼키지 않는다.
        DATA.on("GET " + INTERNAL + "/join-requests/" + REQUEST, request ->
                ok("{\"id\":\"" + REQUEST + "\",\"islandId\":\"" + ISLAND + "\",\"status\":\"pending\","
                        + "\"version\":1}"));
        mockMvc.perform(auth(get("/me/join-requests/" + REQUEST)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(REQUEST.toString()));
        assertThat(DATA.hits(DATA_MY_REQUESTS)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 커서

    @Test
    @DisplayName("커서는 검색어에 묶인다 — 검색어가 바뀌면 재사용할 수 없다")
    void cursorIsBoundToTheFilterThatIssuedIt() throws Exception {
        DATA.on(DATA_SEARCH, request -> ok("{\"items\":[" + SUMMARY + "],\"nextIslandId\":\""
                + ISLAND + "\"}"));

        MvcResult first = mockMvc.perform(auth(get("/islands")).param("q", "모래"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nextCursor").isNotEmpty()).andReturn();
        String cursor = com.jayway.jsonpath.JsonPath.read(
                first.getResponse().getContentAsString(), "$.data.nextCursor");
        assertThat(cursor).as("커서에 검색어 원문을 싣지 않는다").doesNotContain("모래");

        // 같은 검색어면 통과하고 경계가 상류로 전달된다.
        mockMvc.perform(auth(get("/islands")).param("q", "모래").param("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_SEARCH).get(1).query()).contains("cursorIslandId=" + ISLAND);

        // 검색어가 바뀌면 같은 커서가 무효다.
        int before = DATA.hits(DATA_SEARCH);
        mockMvc.perform(auth(get("/islands")).param("q", "바위").param("cursor", cursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.hits(DATA_SEARCH)).as("거절은 네트워크 전에 끝난다").isEqualTo(before);
    }

    @Test
    @DisplayName("위조 커서는 첫 페이지로 조용히 접히지 않는다")
    void forgedCursorIsRejectedRatherThanIgnored() throws Exception {
        DATA.on(DATA_SEARCH, request -> ok("{\"items\":[],\"nextIslandId\":null}"));

        mockMvc.perform(auth(get("/islands")).param("cursor", "ci.Zm9yZ2Vk.".concat("A".repeat(43))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
        assertThat(DATA.hits(DATA_SEARCH)).isZero();
    }

    @Test
    @DisplayName("limit 이 1~100 밖이면 422 이고 상류를 부르지 않는다")
    void limitOutsideTheContractRangeIsRejectedBeforeTheNetwork() throws Exception {
        DATA.on(DATA_SEARCH, request -> ok("{\"items\":[],\"nextIslandId\":null}"));

        mockMvc.perform(auth(get("/islands")).param("limit", "101"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("limit"));
        mockMvc.perform(auth(get("/islands")).param("limit", "0"))
                .andExpect(status().isUnprocessableEntity());
        mockMvc.perform(auth(get("/islands")).param("limit", "many"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.hits(DATA_SEARCH)).isZero();
    }

    // ---------------------------------------------------------------- 오류 표

    @ParameterizedTest
    @CsvSource({"403,OBSERVATORY_LOCKED,403,FACILITY_LOCKED,",
            "403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "400,INVALID_REQUEST,400,INVALID_REQUEST,",
            "409,SESSION_IN_PROGRESS,409,STATE_CONFLICT,",
            "409,GROUP_LIMIT_EXCEEDED,409,STATE_CONFLICT,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,MEMBER_ONLY,502,UPSTREAM_CONTRACT_ERROR,",
            "403,SESSION_IN_PROGRESS,502,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_ISLAND_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 502 다")
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_SWITCH, request -> error(upstreamStatus, code));

        MvcResult result = mockMvc.perform(write(put("/me/current-island"),
                        "{\"islandId\":\"" + ISLAND + "\"}"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString())
                .as("상류의 내부 문구가 공개 응답에 새지 않는다").doesNotContain("private detail");
    }

    // ---------------------------------------------------------------- 입력 거절

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "\"x\"", "{\"name\":\"섬\"}",
            "{\"name\":\"섬\",\"approvalRequired\":\"false\"}",
            "{\"name\":123,\"approvalRequired\":false}",
            "{\"name\":\"섬\",\"approvalRequired\":false,\"maxMembers\":99}",
        "{\"name\":\"섬\",\"approvalRequired\":false,\"maxMembers\":0}",
        "{\"name\":\"섬\",\"approvalRequired\":false,\"maxMembers\":-1}",
        "{\"name\":\"섬\",\"approvalRequired\":false,\"maxMembers\":\"15\"}",
        // 32비트 경계 — intValue() 로 먼저 자르면 4294967297 이 1 로 접혀 통과한다(2^31 은 -2147483648).
        "{\"name\":\"섬\",\"approvalRequired\":false,\"maxMembers\":2147483648}",
        "{\"name\":\"섬\",\"approvalRequired\":false,\"maxMembers\":4294967297}",
            "{\"name\":\"섬\",\"approvalRequired\":false,\"password\":\"1234\"}"})
    @DisplayName("본문 모양이 어긋나면 네트워크 전에 400 이다 — maxMembers·password 주입도 여기서 막힌다")
    void rejectsBodyShapeBeforeTheNetwork(String body) throws Exception {
        DATA.on(DATA_CREATE, request -> ok(CREATED));

        mockMvc.perform(write(post("/islands"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("빈 이름과 길이 초과는 422 이고 서버가 잘라 성공시키지 않는다")
    void blankOrOverlongNameIsUnprocessable() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(CREATED));

        mockMvc.perform(write(post("/islands"), "{\"name\":\"   \",\"approvalRequired\":false}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("name"));
        mockMvc.perform(write(post("/islands"),
                        "{\"name\":\"" + "가".repeat(51) + "\",\"approvalRequired\":false}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("name"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("쓰기는 UUID 멱등키 하나와 서명 세션을 요구한다")
    void writesRequireOneUuidKeyAndASignedSession() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(CREATED));

        mockMvc.perform(auth(post("/islands")).contentType(MediaType.APPLICATION_JSON)
                        .content(CREATE_BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(post("/islands").header("Idempotency-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(CREATE_BODY))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/islands").header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("경로의 islandId 가 UUID 가 아니면 400 이고 상류를 부르지 않는다")
    void malformedIslandIdNeverReachesUpstream() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"visitor\",\"visitor\":" + SUMMARY
                + ",\"member\":null}"));

        mockMvc.perform(auth(get("/islands/not-a-uuid")))
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

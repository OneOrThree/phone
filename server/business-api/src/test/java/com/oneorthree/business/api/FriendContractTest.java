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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 친구 8종 공개 표면 (GROMO-1894 7종 + GROMO-1996 검색) — 무접두 경로가 Business 에 있고 Data 로는
 * {@code /internal/users/{userId}/…} 로만 나간다는 것을 실제 필터·컨트롤러·HTTP 로 확인한다.
 */
class FriendContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000021");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000021");
    private static final UUID TARGET = UUID.fromString("cccccccc-0000-0000-0000-000000000021");
    private static final UUID REQUEST = UUID.fromString("dddddddd-0000-0000-0000-000000000021");
    private static final String INTERNAL = "/internal/users/" + USER;
    private static final String DATA_CREATE = "POST " + INTERNAL + "/friend-requests";
    private static final String DATA_FRIENDS = "GET " + INTERNAL + "/friends";
    private static final String DATA_REQUESTS = "GET " + INTERNAL + "/friend-requests";
    private static final String DATA_DELETE = "DELETE " + INTERNAL + "/friends/" + TARGET;
    private static final String DATA_SEARCH = "GET " + INTERNAL + "/friend-search";
    private static final String SEARCH_HIT = "[{\"userId\":\"" + TARGET + "\",\"nickname\":\"짝꿍\","
            + "\"tierLevel\":null,\"occupation\":null,\"relation\":\"NONE\"}]";
    private static final String CREATE_BODY = "{\"targetUserId\":\"" + TARGET + "\"}";
    private static final String FRIEND = "{\"userId\":\"" + TARGET + "\",\"nickname\":\"짝꿍\",\"tierLevel\":3,"
            + "\"occupation\":\"CODING\",\"isPinned\":true,\"isFocusing\":true,\"focusTimeMinutes\":42,"
            + "\"focusStartedAt\":\"2026-09-18T01:00:00Z\",\"focusTagName\":\"전공\","
            + "\"mainIslandName\":\"모래섬\"}";

    @Test
    void createForwardsSignedActorWithoutCommandKeyAndReturnsCreatedEnvelope() throws Exception {
        DATA.on(DATA_CREATE, request -> ok(state("PENDING")));
        mockMvc.perform(write(post("/friends/requests"), CREATE_BODY).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                // 본문 없는 명령도 봉투는 있어야 한다 — 빈 본문·{} 이면 여기서 깨진다.
                .andExpect(content().json("{\"data\":null}"));
        assertThat(DATA.hits(DATA_CREATE)).isEqualTo(1);
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        // 멱등키 적용표(api-platform LLD §2)에 없는 명령이다 — 앱이 보내지 않았으니 상류로도 나가지 않는다.
        assertThat(sent.header("idempotency-key")).isNull();
        assertThat(sent.body()).contains(TARGET.toString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"targetUserId\":null}", "{\"targetUserId\":1}",
            "{\"targetUserId\":\"cccccccc-0000-0000-0000-000000000021\",\"extra\":1}"})
    void createRejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(post("/friends/requests"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void createRejectsMalformedTargetAndRequiresSignedSession() throws Exception {
        mockMvc.perform(write(post("/friends/requests"), "{\"targetUserId\":\"1-2-3-4-5\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("targetUserId"));
        mockMvc.perform(post("/friends/requests").contentType(MediaType.APPLICATION_JSON).content(CREATE_BODY))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    /** 빈 2xx 는 「상류가 요청을 만들었다」의 증거가 아니다 — 계약 불일치(502)로 올린다. */
    @ParameterizedTest
    @ValueSource(strings = {"", "null", "{}", "{\"requestId\":null,\"status\":\"PENDING\"}"})
    void createRejectsEmptyOrIncompleteUpstreamBody(String body) throws Exception {
        DATA.on(DATA_CREATE, request -> ok(body));
        mockMvc.perform(write(post("/friends/requests"), CREATE_BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @ParameterizedTest
    @CsvSource({"accept,ACCEPTED", "reject,REJECTED", "cancel,CANCELED"})
    void requestActionsHitTheirOwnInternalPath(String action, String resulting) throws Exception {
        String upstream = "POST " + INTERNAL + "/friend-requests/" + REQUEST + "/" + action;
        DATA.on(upstream, request -> ok(state(resulting)));
        mockMvc.perform(auth(post("/friends/requests/" + REQUEST + "/" + action)))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"data\":null}"));
        assertThat(DATA.hits(upstream)).isEqualTo(1);
        assertThat(DATA.received().get(0).header("x-user-id")).isEqualTo(USER.toString());
    }

    /** 상류가 다른 상태를 돌려주면 배선 사고다 — 성공으로 접지 않는다. */
    @Test
    void acceptRejectsMismatchedResultingStateAsContractError() throws Exception {
        DATA.on("POST " + INTERNAL + "/friend-requests/" + REQUEST + "/accept", request -> ok(state("PENDING")));
        mockMvc.perform(auth(post("/friends/requests/" + REQUEST + "/accept")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void requestActionsRejectMalformedIdBeforeNetwork() throws Exception {
        mockMvc.perform(auth(post("/friends/requests/1-2-3-4-5/cancel")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("requestId"));
        assertThat(DATA.received()).isEmpty();
    }

    /** LLD 의 204 는 공개 봉투 규칙(데이터 없는 명령 = 200 {@code data:null})으로 200 이 된다. */
    @Test
    void deleteForwardsToInternalDeleteAndReturnsEmptyEnvelope() throws Exception {
        DATA.on(DATA_DELETE, request -> ok("{\"friendshipId\":\"" + REQUEST + "\"}"));
        mockMvc.perform(auth(delete("/friends/" + TARGET)))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"data\":null}"));
        assertThat(DATA.hits(DATA_DELETE)).isEqualTo(1);
        DATA.on(DATA_DELETE, request -> ok(""));
        mockMvc.perform(auth(delete("/friends/" + TARGET)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void friendsPassesDateThroughAndReturnsArrayInEnvelope() throws Exception {
        DATA.on(DATA_FRIENDS, request -> ok("[" + FRIEND + "]"));
        mockMvc.perform(auth(get("/friends")).queryParam("date", "2026-09-18"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].userId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data[0].isPinned").value(true))
                .andExpect(jsonPath("$.data[0].isFocusing").value(true))
                .andExpect(jsonPath("$.data[0].focusTimeMinutes").value(42))
                .andExpect(jsonPath("$.data[0].focusStartedAt").value("2026-09-18T01:00:00Z"))
                // 메인 섬 이름은 Data 가 준 값을 그대로 내보낸다(GROMO-1971) — 친구 목록에만 실린다.
                .andExpect(jsonPath("$.data[0].mainIslandName").value("모래섬"));
        assertThat(DATA.received().get(0).query()).contains("date=2026-09-18");
        DATA.on(DATA_FRIENDS, request -> ok("[]"));
        mockMvc.perform(auth(get("/friends")).queryParam("date", "2026-09-18"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isEmpty());
    }

    /** 항목에 필수 키가 빠지면 계약 불일치다 — 이름이 바뀐 배포를 조용히 통과시키지 않는다. */
    @Test
    void friendsRejectsItemMissingRequiredKey() throws Exception {
        DATA.on(DATA_FRIENDS, request -> ok("[{\"nickname\":\"x\",\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0}]"));
        mockMvc.perform(auth(get("/friends")).queryParam("date", "2026-09-18"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @ParameterizedTest
    @CsvSource({"/friends,date", "/friends/requests,type"})
    void listsRequireExactlyOneQueryParameterBeforeNetwork(String path, String name) throws Exception {
        mockMvc.perform(auth(get(path)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value(name));
        mockMvc.perform(auth(get(path)).queryParam(name, "a").queryParam(name, "b"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value(name));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void friendRequestsPassesTypeThrough() throws Exception {
        DATA.on(DATA_REQUESTS, request -> ok("[{\"requestId\":\"" + REQUEST + "\",\"userId\":\"" + TARGET
                + "\",\"nickname\":\"짝꿍\",\"tierLevel\":null,\"createdAt\":\"2026-09-18T00:00:00Z\"}]"));
        mockMvc.perform(auth(get("/friends/requests")).queryParam("type", "received"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].requestId").value(REQUEST.toString()))
                .andExpect(jsonPath("$.data[0].tierLevel").doesNotExist());
        assertThat(DATA.received().get(0).query()).contains("type=received");
    }

    @ParameterizedTest
    @CsvSource({"400,SELF_REQUEST,400,INVALID_PARAMETER,targetUserId",
            "409,ALREADY_FRIEND,409,STATE_CONFLICT,targetUserId",
            "409,REQUEST_ALREADY_EXISTS,409,STATE_CONFLICT,targetUserId",
            "409,DATA_INTEGRITY_VIOLATION,409,STATE_CONFLICT,targetUserId",
            "404,TARGET_USER_NOT_FOUND,404,NOT_FOUND,targetUserId",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,SELF_REQUEST,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_FRIEND_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    void createMapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_CREATE, request -> error(upstreamStatus, code));
        var result = mockMvc.perform(write(post("/friends/requests"), CREATE_BODY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    @ParameterizedTest
    @CsvSource({"accept,403,NOT_REQUEST_RECEIVER,403,FORBIDDEN",
            "accept,409,INVALID_REQUEST_STATUS,409,STATE_CONFLICT",
            "accept,404,REQUEST_NOT_FOUND,404,NOT_FOUND",
            "cancel,403,NOT_REQUEST_SENDER,403,FORBIDDEN",
            "reject,409,INVALID_REQUEST_STATUS,409,STATE_CONFLICT"})
    void requestActionsMapDomainFailuresWithRequestIdField(String action, int upstreamStatus, String code,
            int publicStatus, String publicCode) throws Exception {
        DATA.on("POST " + INTERNAL + "/friend-requests/" + REQUEST + "/" + action,
                request -> error(upstreamStatus, code));
        mockMvc.perform(auth(post("/friends/requests/" + REQUEST + "/" + action)))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value("requestId"));
    }

    /**
     * 계정당 시간 한도(GROMO-1934) — Data 의 429 RATE_LIMITED 는 도메인 표에 없어 이름 매핑으로 공개
     * RATE_LIMITED 가 되고, 본문의 retryAfterMs 는 초 단위 올림 Retry-After 가 된다(policy: 양의 초).
     * 잡는 회귀: 도메인 표가 이 코드를 다른 것으로 삼키거나, 헤더 없이 나가거나, 내림으로 0초가 되는 것.
     */
    @Test
    void createPassesUpstreamRateLimitThroughAsPublic429WithRetryAfter() throws Exception {
        DATA.on(DATA_CREATE, request -> new MockUpstream.Response(429,
                "{\"code\":\"RATE_LIMITED\",\"message\":\"private detail\",\"retryAfterMs\":1500}"));
        var result = mockMvc.perform(write(post("/friends/requests"), CREATE_BODY))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"))
                .andExpect(header().string("Retry-After", "2")).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
        assertThat(DATA.hits(DATA_CREATE)).as("429 는 재시도하지 않는다").isEqualTo(1);
    }

    @Test
    void deleteMapsNotFriendToNotFoundOnFriendUserId() throws Exception {
        DATA.on(DATA_DELETE, request -> error(404, "NOT_FRIEND"));
        mockMvc.perform(auth(delete("/friends/" + TARGET)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error.field").value("friendUserId"));
    }

    // ---------------------------------------------------------------- 검색 (GROMO-1996)

    /**
     * nginx 가 {@code /friends/*} 를 Business 로 보내는데 이 매핑이 없어 404 로 죽어 있던 자리다 —
     * 이 테스트가 그 회귀의 방어선이다. 내부로는 {@code /friend-search}(친구 삭제와 세그먼트 충돌을
     * 피한 이름)로 나가고, {@code type}·{@code q} 는 해석하지 않고 그대로 전달한다.
     */
    @Test
    void searchForwardsSignedActorAndParamsVerbatim() throws Exception {
        DATA.on(DATA_SEARCH, request -> ok(SEARCH_HIT));
        mockMvc.perform(auth(get("/friends/search")).param("type", "NICKNAME").param("q", "짝꿍")
                        .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].userId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data[0].relation").value("NONE"))
                // 비친구라 Data 가 null 로 떨군 값이다 — Business 가 채워 넣지 않는다.
                .andExpect(jsonPath("$.data[0].tierLevel").doesNotExist())
                .andExpect(jsonPath("$.data[0].occupation").doesNotExist());
        assertThat(DATA.hits(DATA_SEARCH)).isEqualTo(1);
        var sent = DATA.received().get(0);
        assertThat(sent.header("x-user-id")).isEqualTo(USER.toString());
        assertThat(sent.query()).contains("type=NICKNAME");
    }

    /** 「그런 사람 없음」은 빈 배열이다 — 404 로 바꾸면 앱이 오류 화면을 그린다. */
    @Test
    void searchReturnsEmptyArrayWhenNobodyMatches() throws Exception {
        DATA.on(DATA_SEARCH, request -> ok("[]"));
        mockMvc.perform(auth(get("/friends/search")).param("type", "NICKNAME").param("q", "없는닉"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    /** {@code type}·{@code q} 는 둘 다 필수다 — 없거나 중복이면 상류로 나가기 전에 400 이다. */
    @ParameterizedTest
    @CsvSource({"type,q", "q,type"})
    void searchRequiresBothParamsBeforeNetwork(String present, String missing) throws Exception {
        mockMvc.perform(auth(get("/friends/search")).param(present, "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value(missing));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void searchRequiresSignedSession() throws Exception {
        mockMvc.perform(get("/friends/search").param("type", "NICKNAME").param("q", "x"))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    /** 모르는 검색 수단은 Data 가 판정한다 — 공개 표면에서는 field=type 의 INVALID_PARAMETER 다. */
    @ParameterizedTest
    @CsvSource({"400,INVALID_SEARCH_TYPE,400,INVALID_PARAMETER,type",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "400,UNKNOWN_FRIEND_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    void searchMapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_SEARCH, request -> error(upstreamStatus, code));
        mockMvc.perform(auth(get("/friends/search")).param("type", "BOGUS").param("q", "x"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field));
    }

    /**
     * 빈 2xx 나 필수 키가 빠진 항목은 계약 불일치(502)다 — 이름이 바뀐 배포를 조용히 통과시키지 않는다.
     *
     * <p>{@code nickname} 도 {@code userId}·{@code relation} 과 같은 필수다(codex 리뷰) — 검색 결과에서
     * 닉네임이 빠지면 앱이 「누구인지 모르는 검색 결과」를 그린다. 롤링 배포로 Data 가 필드를 빠뜨리면
     * 조용히 200 으로 흘리지 말고 502 로 올린다.
     */
    @ParameterizedTest
    @ValueSource(strings = {"", "null", "[{}]",
            "[{\"userId\":null,\"relation\":\"NONE\"}]",
            "[{\"userId\":\"cccccccc-0000-0000-0000-000000000021\",\"nickname\":\"짝꿍\"}]",
            "[{\"userId\":\"cccccccc-0000-0000-0000-000000000021\",\"relation\":null}]",
            "[{\"userId\":\"cccccccc-0000-0000-0000-000000000021\",\"relation\":\"NONE\"}]",
            "[{\"userId\":\"cccccccc-0000-0000-0000-000000000021\",\"nickname\":null,"
                    + "\"relation\":\"NONE\"}]"})
    void searchRejectsIncompleteUpstreamBody(String body) throws Exception {
        DATA.on(DATA_SEARCH, request -> ok(body));
        mockMvc.perform(auth(get("/friends/search")).param("type", "NICKNAME").param("q", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String state(String status) {
        return "{\"requestId\":\"" + REQUEST + "\",\"status\":\"" + status + "\"}";
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}

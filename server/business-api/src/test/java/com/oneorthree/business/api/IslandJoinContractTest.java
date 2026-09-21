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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 가입·초대 공개 5종의 계약 (GROMO-1760) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 *
 * <p>상류의 원자 변경은 data-api 의 {@code IslandJoinIntegrationTest} 가 본다. 여기서 보는 것은
 * <b>경계</b> 다: 주체를 무엇으로 정하는가, 멱등키를 그대로 전달하는가(재생은 상류 receipt 몫),
 * 본문 화이트리스트, 어떤 상류 실패만 공개 오류로 옮기는가.
 */
class IslandJoinContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1760-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1760-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1760-0000-0000-000000000001");
    private static final UUID REQUEST = UUID.fromString("dddddddd-1760-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("eeeeeeee-1760-0000-0000-000000000001");
    private static final String KEY = "ffffffff-1760-5000-8000-000000000001";

    private static final String INTERNAL = "/internal/users/" + USER;
    private static final String DATA_JOIN = "POST " + INTERNAL + "/islands/" + ISLAND + "/memberships";
    private static final String DATA_REQUEST = "GET " + INTERNAL + "/join-requests/" + REQUEST;
    private static final String DATA_CANCEL = "DELETE " + INTERNAL + "/join-requests/" + REQUEST;
    private static final String DATA_RESOLVE = "POST " + INTERNAL + "/invitations/resolve";
    private static final String DATA_INVITE = "POST " + INTERNAL + "/islands/" + ISLAND + "/invitations";

    private static final String SUMMARY = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\","
            + "\"visibility\":\"public\",\"approvalRequired\":true,\"memberCount\":3,\"maxMembers\":15,"
            + "\"membershipStatus\":\"none\",\"joinRequestId\":null,"
            + "\"growthStage\":null,\"themeId\":null}";
    private static final String JOINED = "{\"status\":\"active\",\"requestId\":null,\"islandId\":\""
            + ISLAND + "\",\"currentIslandId\":\"" + ISLAND + "\",\"version\":3}";
    private static final String PENDING = "{\"status\":\"pending\",\"requestId\":\"" + REQUEST
            + "\",\"islandId\":\"" + ISLAND + "\",\"currentIslandId\":null,\"version\":0}";
    private static final String REQUEST_VIEW = "{\"id\":\"" + REQUEST + "\",\"islandId\":\"" + ISLAND
            + "\",\"status\":\"pending\",\"version\":0}";
    private static final String CANCELLED = "{\"id\":\"" + REQUEST + "\",\"status\":\"cancelled\"}";
    private static final String RESOLVED = "{\"island\":" + SUMMARY
            + ",\"invitationToken\":\"opaque-token\"}";
    private static final String ISSUED = "{\"code\":\"abcd2345\",\"url\":\"https://example.test/i/abcd2345\","
            + "\"expiresAt\":null}";

    // ---------------------------------------------------------------- 주체·멱등키

    @Test
    @DisplayName("가입은 서명 세션의 주체와 앱의 멱등키를 그대로 전달하고 공격자 헤더는 버린다")
    void joinForwardsOnlyTheSignedSubjectAndTheAppKey() throws Exception {
        DATA.on(DATA_JOIN, request -> ok(PENDING));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"),
                        "{\"invitationToken\":\"opaque-token\"}")
                        .header("X-User-Id", OTHER)
                        .header("X-Service-Token", "stolen"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("pending"))
                .andExpect(jsonPath("$.data.requestId").value(REQUEST.toString()));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_JOIN).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Authorization")).isEqualTo("Bearer ci-token-data");
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.header("X-Service-Token")).isNull();
        assertThat(forwarded.body()).isEqualTo("{\"invitationToken\":\"opaque-token\"}");
    }

    @Test
    @DisplayName("가입 본문은 없어도 되고 없으면 invitationToken 은 null 로 전달된다")
    void joinWithoutBodySendsANullToken() throws Exception {
        DATA.on(DATA_JOIN, request -> ok(JOINED));

        mockMvc.perform(auth(post("/islands/" + ISLAND + "/memberships"))
                        .header("Idempotency-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("active"));

        assertThat(DATA.receivedFor(DATA_JOIN).get(0).body())
                .isEqualTo("{\"invitationToken\":null}");
    }

    @Test
    @DisplayName("즉시 가입은 상류가 확정한 current 를 돌려주고 pending 은 current 를 새로 정하지 않는다")
    void immediateJoinReportsTheConfirmedCurrentAndPendingDoesNotMoveIt() throws Exception {
        DATA.on(DATA_JOIN, request -> ok(JOINED));
        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), "{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("active"))
                .andExpect(jsonPath("$.data.currentIslandId").value(ISLAND.toString()));

        DATA.reset();
        DATA.on(DATA_JOIN, request -> ok(PENDING));
        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), "{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("pending"))
                .andExpect(jsonPath("$.data.currentIslandId").value(nullValue()));
    }

    @Test
    @DisplayName("같은 키의 재시도는 상류가 저장한 receipt 를 재생한다 — Business 는 결과를 스스로 만들지 않는다")
    void sameKeyReplaysTheUpstreamReceipt() throws Exception {
        DATA.on(DATA_JOIN, request -> ok(PENDING));

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), "{}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.status").value("pending"))
                    .andExpect(jsonPath("$.data.requestId").value(REQUEST.toString()));
        }
        // 두 번 모두 상류에 도달해 같은 저장 결과를 받는다 — 재생 판정·저장은 전부 Data 의 receipt 다.
        assertThat(DATA.hits(DATA_JOIN)).isEqualTo(2);
    }

    @Test
    @DisplayName("세 개의 변경 명령은 UUID 멱등키를 요구하고 해석은 요구하지 않는다")
    void commandsRequireAUuidKeyButResolveDoesNot() throws Exception {
        DATA.on(DATA_RESOLVE, request -> ok(RESOLVED));

        mockMvc.perform(auth(post("/islands/" + ISLAND + "/memberships"))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(auth(delete("/me/join-requests/" + REQUEST)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(auth(post("/islands/" + ISLAND + "/invitations")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));

        mockMvc.perform(auth(post("/invitations/resolve"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"abcd2345\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.invitationToken").value("opaque-token"));

        assertThat(DATA.receivedFor(DATA_RESOLVE).get(0).header("Idempotency-Key")).isNull();
        assertThat(DATA.receivedFor(DATA_RESOLVE).get(0).body()).isEqualTo("{\"code\":\"abcd2345\"}");
    }

    // ---------------------------------------------------------------- 상태·취소·발급

    @Test
    @DisplayName("가입 요청 상태는 본인 확인된 응답만 돌려주고 남의 요청은 404 다")
    void joinRequestStatusIsScopedToItsOwner() throws Exception {
        DATA.on(DATA_REQUEST, request -> ok(REQUEST_VIEW));

        mockMvc.perform(auth(get("/me/join-requests/" + REQUEST)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(REQUEST.toString()))
                .andExpect(jsonPath("$.data.status").value("pending"))
                .andExpect(jsonPath("$.data.version").value(0));

        assertThat(DATA.receivedFor(DATA_REQUEST).get(0).header("Idempotency-Key")).isNull();

        DATA.reset();
        DATA.on(DATA_REQUEST, request -> error(404, "JOIN_REQUEST_NOT_FOUND"));
        mockMvc.perform(auth(get("/me/join-requests/" + REQUEST)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("취소는 멱등키와 함께 DELETE 로 전달되고 성공은 항상 cancelled 다")
    void cancelForwardsTheKeyAndAlwaysReportsCancelled() throws Exception {
        DATA.on(DATA_CANCEL, request -> ok(CANCELLED));

        mockMvc.perform(auth(delete("/me/join-requests/" + REQUEST))
                        .header("Idempotency-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(REQUEST.toString()))
                .andExpect(jsonPath("$.data.status").value("cancelled"));

        assertThat(DATA.receivedFor(DATA_CANCEL).get(0).header("Idempotency-Key")).isEqualTo(KEY);
    }

    @Test
    @DisplayName("초대 발급은 본문 없이 멱등키만 전달하고 code·url 을 그대로 돌려준다")
    void issueForwardsOnlyTheKeyAndReturnsTheIssuedCode() throws Exception {
        DATA.on(DATA_INVITE, request -> ok(ISSUED));

        mockMvc.perform(auth(post("/islands/" + ISLAND + "/invitations"))
                        .header("Idempotency-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.code").value("abcd2345"))
                .andExpect(jsonPath("$.data.url").value("https://example.test/i/abcd2345"));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_INVITE).get(0);
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
    }

    // ---------------------------------------------------------------- 오류 표

    @ParameterizedTest
    @CsvSource({"422,INVITATION_CODE_INVALID,422,OUT_OF_RANGE",
            "410,INVITATION_EXPIRED,410,INVITATION_EXPIRED",
            "404,SLUG_NOT_FOUND,404,SLUG_NOT_FOUND",
            "403,INVITATION_REQUIRED,403,FORBIDDEN",
            "403,ISLAND_JOIN_UNAVAILABLE,403,FORBIDDEN",
            "403,KICKED_CANNOT_REJOIN,403,FORBIDDEN",
            "409,ALREADY_MEMBER,409,STATE_CONFLICT",
            "409,ROOM_FULL,409,STATE_CONFLICT",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED",
            // 같은 코드라도 상태가 어긋나면 조용히 옮기지 않는다 — 계약 불일치 502.
            "400,INVITATION_CODE_INVALID,502,UPSTREAM_CONTRACT_ERROR",
            "404,INVITATION_EXPIRED,502,UPSTREAM_CONTRACT_ERROR",
            "400,UNKNOWN_JOIN_ERROR,502,UPSTREAM_CONTRACT_ERROR"})
    @DisplayName("가입의 (상태, 코드) 쌍만 공개 오류로 옮긴다 — 형식 422 와 폐기 410 의 원본 의미를 지킨다")
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode) throws Exception {
        DATA.on(DATA_JOIN, request -> error(upstreamStatus, code));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), "{}"))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode));
    }

    @ParameterizedTest
    @CsvSource({"404,JOIN_REQUEST_NOT_FOUND,404,NOT_FOUND",
            "409,JOIN_REQUEST_TERMINAL,409,STATE_CONFLICT",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND"})
    @DisplayName("취소의 (상태, 코드) 쌍만 공개 오류로 옮긴다 — terminal 충돌은 409 다")
    void cancelMapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode) throws Exception {
        DATA.on(DATA_CANCEL, request -> error(upstreamStatus, code));

        mockMvc.perform(auth(delete("/me/join-requests/" + REQUEST))
                        .header("Idempotency-Key", KEY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode));
    }

    @Test
    @DisplayName("비주민의 초대 발급 거절은 FORBIDDEN 이다")
    void nonMemberIssueIsForbidden() throws Exception {
        DATA.on(DATA_INVITE, request -> error(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(post("/islands/" + ISLAND + "/invitations"))
                        .header("Idempotency-Key", KEY))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    // ---------------------------------------------------------------- 입력 거절

    @ParameterizedTest
    @ValueSource(strings = {"[]", "\"x\"", "{\"foo\":1}",
            "{\"invitationToken\":\"a\",\"extra\":1}",
            "{\"invitationToken\":123}"})
    @DisplayName("가입 본문 모양이 어긋나면 네트워크 전에 400 이다")
    void rejectsJoinBodyShapeBeforeTheNetwork(String body) throws Exception {
        DATA.on(DATA_JOIN, request -> ok(JOINED));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("65자를 넘는 invitationToken 은 422 이고 잘라 성공시키지 않는다")
    void overlongTokenIsUnprocessable() throws Exception {
        DATA.on(DATA_JOIN, request -> ok(JOINED));

        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"),
                        "{\"invitationToken\":\"" + "t".repeat(65) + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("invitationToken"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"code\":123}", "{\"code\":\"a\",\"extra\":1}", "[]"})
    @DisplayName("해석 본문 모양이 어긋나면 네트워크 전에 400 이다")
    void rejectsResolveBodyShapeBeforeTheNetwork(String body) throws Exception {
        DATA.on(DATA_RESOLVE, request -> ok(RESOLVED));

        mockMvc.perform(auth(post("/invitations/resolve"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("빈 code 와 33자를 넘는 code 는 422 다")
    void blankOrOverlongCodeIsUnprocessable() throws Exception {
        DATA.on(DATA_RESOLVE, request -> ok(RESOLVED));

        mockMvc.perform(auth(post("/invitations/resolve"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"  \"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("code"));
        mockMvc.perform(auth(post("/invitations/resolve"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + "c".repeat(33) + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("code"));
        assertThat(DATA.received()).isEmpty();
    }

    // ---------------------------------------------------------------- 응답 계약

    @Test
    @DisplayName("가입 응답의 섬이 요청과 다르거나 상태·필드가 어긋나면 502 다")
    void mismatchedJoinResponseIsAContractError() throws Exception {
        DATA.on(DATA_JOIN, request -> ok("{\"status\":\"active\",\"requestId\":null,\"islandId\":\""
                + OTHER + "\",\"currentIslandId\":\"" + OTHER + "\",\"version\":1}"));
        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), "{}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

        DATA.reset();
        DATA.on(DATA_JOIN, request -> ok("{\"status\":\"pending\",\"requestId\":null,\"islandId\":\""
                + ISLAND + "\",\"currentIslandId\":null,\"version\":0}"));
        mockMvc.perform(write(post("/islands/" + ISLAND + "/memberships"), "{}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("취소 응답의 id 가 요청과 다르면 502 다")
    void mismatchedCancelResponseIsAContractError() throws Exception {
        DATA.on(DATA_CANCEL, request -> ok("{\"id\":\"" + OTHER + "\",\"status\":\"cancelled\"}"));

        mockMvc.perform(auth(delete("/me/join-requests/" + REQUEST))
                        .header("Idempotency-Key", KEY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
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

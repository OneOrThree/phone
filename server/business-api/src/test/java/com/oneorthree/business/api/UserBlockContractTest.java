package com.oneorthree.business.api;

import com.oneorthree.business.support.UpstreamTestBase;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * /blocks 공개 봉투·내부 경로·오류 변환 계약 (GROMO-1975) 과 차단자에게 보내는 주민 표시의 중립 치환 (GROMO-2183).
 */
class UserBlockContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000075");
    private static final UUID TARGET = UUID.fromString("cccccccc-0000-0000-0000-000000000075");
    private static final String INTERNAL = "/internal/users/" + USER + "/blocks";
    private static final String BODY = "{\"blockedUserId\":\"" + TARGET + "\"}";

    // ── GROMO-2183 중립 표시 ──
    private static final UUID FRIEND = UUID.fromString("dddddddd-0000-0000-0000-000000002183");
    private static final UUID ISLAND = UUID.fromString("eeeeeeee-0000-0000-0000-000000002183");
    private static final UUID SESSION = UUID.fromString("ffffffff-0000-0000-0000-000000002183");
    private static final String NEUTRAL = "차단한 주민";
    private static final String BLOCKS_OF_TARGET = "/internal/users/" + TARGET + "/blocks";

    @Test
    void blockAndUnblockForwardSignedActorAndReturnEmptyEnvelope() throws Exception {
        DATA.on("POST " + INTERNAL, request -> ok(""));
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isOk()).andExpect(content().json("{\"data\":null}"));
        DATA.on("DELETE " + INTERNAL + "/" + TARGET, request -> ok(""));
        mockMvc.perform(auth(delete("/blocks/" + TARGET)))
                .andExpect(status().isOk()).andExpect(content().json("{\"data\":null}"));
        assertThat(DATA.received()).allSatisfy(call ->
                assertThat(call.header("x-user-id")).isEqualTo(USER.toString()));
    }

    @Test
    void listUsesPublicEnvelopeAndPreservesIdNameShape() throws Exception {
        DATA.on("GET " + INTERNAL, request -> ok("[{\"id\":\"" + TARGET + "\",\"name\":\"차단상대\"}]"));
        mockMvc.perform(auth(get("/blocks")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(TARGET.toString()))
                .andExpect(jsonPath("$.data[0].name").value("차단상대"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "[]", "null", "{\"blockedUserId\":1}",
            "{\"blockedUserId\":\"cccccccc-0000-0000-0000-000000000075\",\"extra\":true}"})
    void blockRejectsMalformedBodyBeforeNetwork(String body) throws Exception {
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(body)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void blockMapsOnlyRegisteredDomainFailures() throws Exception {
        DATA.on("POST " + INTERNAL, request -> error(400, "SELF_BLOCK"));
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("blockedUserId"));
        DATA.on("POST " + INTERNAL, request -> error(400, "UNKNOWN_BLOCK_ERROR"));
        mockMvc.perform(auth(post("/blocks").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void blockListProjectsOnlyPublicFieldsAndPreservesOrder(boolean empty) throws Exception {
        String expected = empty ? "[]" : "[{\"id\":\"" + TARGET + "\",\"name\":\"첫 상대\"},"
                + "{\"id\":\"" + USER + "\",\"name\":\"다음 상대\"}]";
        String upstream = expected.replace("\"name\":\"첫 상대\"}", "\"name\":\"첫 상대\",\"block_row_id\":7}")
                .replace("\"name\":\"다음 상대\"}", "\"name\":\"다음 상대\",\"blocked_at\":\"internal\"}");
        DATA.on("GET " + INTERNAL, request -> ok(upstream));
        var result = mockMvc.perform(auth(get("/blocks"))).andExpect(status().isOk()).andReturn();
        var json = new tools.jackson.databind.ObjectMapper();
        assertThat(json.readTree(result.getResponse().getContentAsString()).path("data"))
                .isEqualTo(json.readTree(expected));
    }

    @Test
    @DisplayName("주민 목록 — 요청자가 차단한 주민은 행·ID·역할을 유지한 채 닉네임은 중립 문구, 프로필은 기본값이다")
    void islandMembersMaskBlockedResidentForBlocker() throws Exception {
        DATA.on("GET /internal/islands/" + ISLAND + "/members", request -> ok("{\"items\":["
                + member(USER, "나", "cream", "host", "\"scarf\"", "\"hat\"", "back", 3) + ","
                + member(TARGET, "차단상대", "black", "member", "\"cape\"", "\"flag\"", "back", 7) + ","
                + member(FRIEND, "친구", null, "member", "null", "null", "front", 1)
                + "],\"nextJoinedAt\":null,\"nextMembershipId\":null,\"version\":4}"));
        DATA.on("GET " + INTERNAL, request -> ok("[{\"id\":\"" + TARGET + "\",\"name\":\"차단상대\"}]"));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/members")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items.length()").value(3))
                .andExpect(jsonPath("$.data.items[0].name").value("나"))
                .andExpect(jsonPath("$.data.items[0].catColor").value("cream"))
                .andExpect(jsonPath("$.data.items[0].appearance.clothes").value("scarf"))
                .andExpect(jsonPath("$.data.items[1].id").value(TARGET.toString()))
                .andExpect(jsonPath("$.data.items[1].role").value("member"))
                .andExpect(jsonPath("$.data.items[1].name").value(NEUTRAL))
                .andExpect(jsonPath("$.data.items[1].catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.items[1].appearance.clothes").value(nullValue()))
                .andExpect(jsonPath("$.data.items[1].appearance.decor").value(nullValue()))
                .andExpect(jsonPath("$.data.items[1].appearance.hull").value("raft"))
                .andExpect(jsonPath("$.data.items[1].appearance.position").value("front"))
                .andExpect(jsonPath("$.data.items[1].appearance.version").value(7))
                .andExpect(jsonPath("$.data.items[2].name").value("친구"));
        assertThat(DATA.receivedFor("GET " + INTERNAL)).singleElement()
                .satisfies(call -> assertThat(call.header("x-user-id")).isEqualTo(USER.toString()));
    }

    @Test
    @DisplayName("주민 목록 — 가릴 후보가 요청자 본인뿐이면 차단 목록을 부르지 않는다")
    void islandMembersSkipBlockLookupWhenOnlySelf() throws Exception {
        DATA.on("GET /internal/islands/" + ISLAND + "/members", request -> ok("{\"items\":["
                + member(USER, "나", "cream", "host", "null", "null", "front", 0)
                + "],\"nextJoinedAt\":null,\"nextMembershipId\":null,\"version\":1}"));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/members")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].name").value("나"));
        assertThat(DATA.hits("GET " + INTERNAL)).isZero();
    }

    @Test
    @DisplayName("주민 목록 — 차단 목록을 못 읽으면 원래 닉네임을 내보내지 않고 실패한다")
    void islandMembersFailClosedWhenBlockListUnavailable() throws Exception {
        DATA.on("GET /internal/islands/" + ISLAND + "/members", request -> ok("{\"items\":["
                + member(TARGET, "차단상대", "black", "member", "null", "null", "front", 0)
                + "],\"nextJoinedAt\":null,\"nextMembershipId\":null,\"version\":1}"));
        DATA.on("GET " + INTERNAL, request -> new MockUpstream.Response(500, "{}"));

        var result = mockMvc.perform(auth(get("/islands/" + ISLAND + "/members")))
                .andExpect(jsonPath("$.error.code").exists())
                .andExpect(jsonPath("$.data").doesNotExist())
                .andReturn();
        assertThat(result.getResponse().getStatus()).isNotEqualTo(200);
        assertThat(result.getResponse().getContentAsString()).doesNotContain("차단상대");
    }

    @Test
    @DisplayName("집중 주민 — 차단 대상의 이름만 중립 문구이고 집중 상태·경과 시간·watermark 는 그대로다")
    void focusMembersMaskBlockedNameButKeepFocusState() throws Exception {
        DATA.on("GET /internal/islands/" + ISLAND + "/focus-members", request -> ok("{\"items\":["
                + focusItem(TARGET, "\"차단상대\"", 1320, "active") + ","
                + focusItem(FRIEND, "\"친구\"", 600, "paused")
                + "],\"serverNow\":\"2026-10-01T09:10:00Z\",\"watermarks\":["
                + "{\"projection\":\"focus.member\",\"islandId\":\"" + ISLAND + "\",\"aggregateId\":\"" + TARGET
                + "\",\"version\":5}]}"));
        DATA.on("GET " + INTERNAL, request -> ok("[{\"id\":\"" + TARGET + "\",\"name\":\"차단상대\"}]"));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/focus-members")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].userId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data.items[0].name").value(NEUTRAL))
                .andExpect(jsonPath("$.data.items[0].subject").value("영어 단어"))
                .andExpect(jsonPath("$.data.items[0].activeSeconds").value(1320))
                .andExpect(jsonPath("$.data.items[0].status").value("active"))
                .andExpect(jsonPath("$.data.items[1].name").value("친구"))
                .andExpect(jsonPath("$.data.items[1].status").value("paused"))
                .andExpect(jsonPath("$.data.watermarks[0].aggregateId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data.watermarks[0].version").value(5));
    }

    @Test
    @DisplayName("집중 주민 — 요청자가 차단한 사람만 가린다(한 방향), 본인 행은 차단 목록을 부르지 않는다")
    void focusMembersMaskOnlyViewersOwnBlocks() throws Exception {
        DATA.on("GET /internal/islands/" + ISLAND + "/focus-members", request -> ok("{\"items\":["
                + focusItem(USER, "\"나\"", 60, "active")
                + "],\"serverNow\":\"2026-10-01T09:10:00Z\",\"watermarks\":[]}"));
        DATA.on("GET " + BLOCKS_OF_TARGET, request -> ok("[{\"id\":\"" + USER + "\",\"name\":\"나\"}]"));

        // 요청자 TARGET 이 USER 를 차단했다 — TARGET 에게는 USER 가 중립 표시다.
        mockMvc.perform(get("/islands/" + ISLAND + "/focus-members")
                        .header("Authorization", "Bearer " + Tokens.accessWithSession(TARGET, 3, SESSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].name").value(NEUTRAL));
        // 차단당한 USER 자신이 보면 본인 행이라 원래 이름이고 차단 목록도 부르지 않는다.
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/focus-members")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].name").value("나"));
        assertThat(DATA.hits("GET " + INTERNAL)).isZero();
    }

    private static String member(UUID id, String name, String catColor, String role, String clothes, String decor,
            String position, long version) {
        return "{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"catColor\":"
                + (catColor == null ? "null" : "\"" + catColor + "\"") + ",\"role\":\"" + role + "\","
                + "\"appearance\":{\"clothes\":" + clothes + ",\"decor\":" + decor + ",\"hull\":\"raft\","
                + "\"position\":\"" + position + "\",\"version\":" + version + "}}";
    }

    private static String focusItem(UUID userId, String name, long activeSeconds, String status) {
        return "{\"userId\":\"" + userId + "\",\"name\":" + name + ",\"sessionId\":\"" + UUID.randomUUID()
                + "\",\"subject\":\"영어 단어\",\"activeSeconds\":" + activeSeconds + ",\"status\":\"" + status
                + "\"}";
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, UUID.randomUUID()));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}

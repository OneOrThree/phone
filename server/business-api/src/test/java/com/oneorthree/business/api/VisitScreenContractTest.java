package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/visit/{islandId}} — 공개 요약을 먼저 읽고 주민 목록과(본인 최신 요청이 있을 때만) 요청 상태를
 * 병렬로 읽는다. 요청이 없으면 호출을 생략하고 {@code joinRequestAvailability:none} 이다(B03·B26). 주민 목록은
 * 방문자 읽기 결정(2026-09-19 V-읽기, GROMO-1937)으로 싣는다.
 */
class VisitScreenContractTest extends ScreenContractTestBase {

    private static final String PATH = "/screens/visit/" + ISLAND;
    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_REQUEST = "GET " + USERS + "/join-requests/" + REQUEST;
    private static final String DATA_MEMBERS = DATA_ISLAND + "/members";
    private static final String MEMBERS = "{\"items\":[{\"id\":\"" + USER + "\",\"name\":\"방장\","
            + "\"role\":\"host\",\"appearance\":{\"clothes\":\"scarf\",\"decor\":null,"
            + "\"hull\":\"raft\",\"position\":\"front\",\"version\":2}}],"
            + "\"nextJoinedAt\":null,\"nextMembershipId\":null,\"version\":4}";

    private static String visitor(UUID joinRequestId) {
        return "{\"scope\":\"visitor\",\"visitor\":" + summary("pending", joinRequestId) + ",\"member\":null}";
    }

    private static String requestView(UUID islandId) {
        return "{\"id\":\"" + REQUEST + "\",\"islandId\":\"" + islandId + "\",\"status\":\"pending\",\"version\":1}";
    }

    @Test
    void ownPendingRequestIsReadAfterThePublicSummary() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok(visitor(REQUEST)));
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));
        DATA.on(DATA_REQUEST, request -> ok(requestView(ISLAND)));
        MvcResult result = mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.members.items[0].name").value("방장"))
                .andExpect(jsonPath("$.data.members.items[0].role").value("host"))
                .andExpect(jsonPath("$.data.members.items[0].appearance.clothes").value("scarf"))
                .andExpect(jsonPath("$.data.members.version").value(4))
                .andExpect(jsonPath("$.data.island.joinRequestId").value(REQUEST.toString()))
                .andExpect(jsonPath("$.data.joinRequestAvailability").value("available"))
                .andExpect(jsonPath("$.data.joinRequest.status").value("pending"))
                .andExpect(jsonPath("$.data.joinRequest.version").value(1))
                .andReturn();
        assertKeys(result, "island", "members", "joinRequestAvailability", "joinRequest");
        assertThat(DATA.receivedFor(DATA_MEMBERS).get(0).query()).contains("limit=30");
    }

    @Test
    void membersCarryOnlyNameCatColorAppearanceAndRole() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok(visitor(null)));
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));
        MvcResult result = mockMvc.perform(auth(get(PATH))).andExpect(status().isOk()).andReturn();
        Map<String, Object> member = JsonPath.read(result.getResponse().getContentAsString(),
                "$.data.members.items[0]");
        // catColor 는 외형 필드다(계정 Q03, GROMO-1945) — 주민 목록과 같은 모양으로 방문자에게도 싣는다.
        assertThat(member.keySet()).containsExactlyInAnyOrder("id", "name", "catColor", "role", "appearance");
    }

    @Test
    void noOwnRequestSkipsTheCallAndReportsNone() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok(visitor(null)));
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));
        MvcResult result = mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.joinRequestAvailability").value("none"))
                .andExpect(jsonPath("$.data.joinRequest").value(nullValue()))
                .andReturn();
        assertKeys(result, "island", "members", "joinRequestAvailability", "joinRequest");
        assertThat(DATA.hits(DATA_REQUEST)).isZero();
        assertThat(DATA.received()).hasSize(2);
    }

    @Test
    void residentStillGetsOnlyThePublicSummaryProjection() throws Exception {
        String detail = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\","
                + "\"approvalRequired\":false,\"memberCount\":1,\"maxMembers\":15,\"membershipStatus\":\"active\","
                + "\"growthStage\":null,\"themeId\":null,\"role\":\"host\",\"version\":3}";
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + detail + "}"));
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.island.membershipStatus").value("active"))
                .andExpect(jsonPath("$.data.island.role").doesNotExist())
                .andExpect(jsonPath("$.data.island.version").doesNotExist())
                .andExpect(jsonPath("$.data.joinRequestAvailability").value("none"));
        assertThat(DATA.hits(DATA_REQUEST)).isZero();
    }

    @Test
    void requiredFragmentFailureFailsTheWholeScreen() throws Exception {
        DATA.on(DATA_ISLAND, request -> domainError(403, "MEMBER_ONLY"));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        assertThat(DATA.hits(DATA_REQUEST)).isZero();
        assertThat(DATA.hits(DATA_MEMBERS)).isZero();

        // 주민 목록 실패도 화면 전체 실패다 — 빈 목록으로 접지 않는다.
        DATA.on(DATA_ISLAND, request -> ok(visitor(null)));
        DATA.on(DATA_MEMBERS, request -> domainError(404, "GROUP_NOT_FOUND"));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("GROUP_NOT_FOUND"));

        // 요청 조회의 404 를 none 으로 접지 않는다.
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));
        DATA.on(DATA_ISLAND, request -> ok(visitor(REQUEST)));
        DATA.on(DATA_REQUEST, request -> domainError(404, "JOIN_REQUEST_NOT_FOUND"));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));

        // 다른 섬의 요청이 돌아오면 availability 불일치 — 계약 오류다.
        DATA.on(DATA_REQUEST, request -> ok(requestView(UUID.randomUUID())));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void rejectsMalformedIslandIdBeforeUpstream() throws Exception {
        mockMvc.perform(auth(get("/screens/visit/not-a-uuid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }
}

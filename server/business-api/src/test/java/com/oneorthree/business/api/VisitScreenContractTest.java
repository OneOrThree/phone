package com.oneorthree.business.api;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/visit/{islandId}} — 공개 요약을 먼저 읽고 본인 최신 요청이 있을 때만 요청 상태를 읽는다.
 * 없으면 호출을 생략하고 {@code joinRequestAvailability:none} 이다(B03·B26).
 */
class VisitScreenContractTest extends ScreenContractTestBase {

    private static final String PATH = "/screens/visit/" + ISLAND;
    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_REQUEST = "GET " + USERS + "/join-requests/" + REQUEST;

    private static String visitor(UUID joinRequestId) {
        return "{\"scope\":\"visitor\",\"visitor\":" + summary("pending", joinRequestId) + ",\"member\":null}";
    }

    private static String requestView(UUID islandId) {
        return "{\"id\":\"" + REQUEST + "\",\"islandId\":\"" + islandId + "\",\"status\":\"pending\",\"version\":1}";
    }

    @Test
    void ownPendingRequestIsReadAfterThePublicSummary() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok(visitor(REQUEST)));
        DATA.on(DATA_REQUEST, request -> ok(requestView(ISLAND)));
        MvcResult result = mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.island.joinRequestId").value(REQUEST.toString()))
                .andExpect(jsonPath("$.data.joinRequestAvailability").value("available"))
                .andExpect(jsonPath("$.data.joinRequest.status").value("pending"))
                .andExpect(jsonPath("$.data.joinRequest.version").value(1))
                .andReturn();
        assertKeys(result, "island", "joinRequestAvailability", "joinRequest");
    }

    @Test
    void noOwnRequestSkipsTheCallAndReportsNone() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok(visitor(null)));
        MvcResult result = mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.joinRequestAvailability").value("none"))
                .andExpect(jsonPath("$.data.joinRequest").value(nullValue()))
                .andReturn();
        assertKeys(result, "island", "joinRequestAvailability", "joinRequest");
        assertThat(DATA.hits(DATA_REQUEST)).isZero();
        assertThat(DATA.received()).hasSize(1);
    }

    @Test
    void residentStillGetsOnlyThePublicSummaryProjection() throws Exception {
        String detail = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\","
                + "\"approvalRequired\":false,\"memberCount\":1,\"membershipStatus\":\"active\","
                + "\"growthStage\":null,\"themeId\":null,\"role\":\"host\",\"version\":3}";
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + detail + "}"));
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

        // 요청 조회의 404 를 none 으로 접지 않는다.
        DATA.on(DATA_ISLAND, request -> ok(visitor(REQUEST)));
        DATA.on(DATA_REQUEST, request -> domainError(404, "JOIN_REQUEST_NOT_FOUND"));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));

        // 다른 섬의 요청이 돌아오면 availability 불일치 — 계약 오류다.
        DATA.on(DATA_REQUEST, request -> ok(requestView(UUID.randomUUID())));
        mockMvc.perform(auth(get(PATH)))
                .andExpect(status().isBadGateway())
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

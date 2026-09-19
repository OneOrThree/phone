package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/explore} — 소속을 먼저 읽고 0개면 발견, 있으면 검색 첫 페이지(B19). 둘을 합치지 않는다.
 */
class ExploreScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_SEARCH = "GET " + USERS + "/island-search";
    private static final String DATA_DISCOVER = "GET " + USERS + "/island-discovery";

    private void memberships(boolean any) {
        DATA.on(DATA_MINE, request -> ok(any
                ? "{\"items\":[" + summary("active", null) + "],\"currentIslandId\":\"" + ISLAND + "\"}"
                : "{\"items\":[],\"currentIslandId\":null}"));
    }

    @Test
    void withoutMembershipsDiscoversAndNeverSearches() throws Exception {
        memberships(false);
        DATA.on(DATA_DISCOVER, request -> ok("{\"items\":[" + summary("none", null) + "],\"nextHandle\":null}"));
        MvcResult result = mockMvc.perform(auth(get("/screens/explore")).param("q", "모래"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.memberships.items").isEmpty())
                .andExpect(jsonPath("$.data.islands.items[0].id").value(ISLAND.toString()))
                .andReturn();
        assertKeys(result, "islands", "memberships");
        assertThat(DATA.hits(DATA_SEARCH)).isZero();
        assertThat(DATA.receivedFor(DATA_DISCOVER).get(0).query()).contains("limit=1");
    }

    @Test
    void withMembershipsSearchesFirstPageWhoseCursorTheDomainGetContinues() throws Exception {
        memberships(true);
        DATA.on(DATA_SEARCH, request -> ok("{\"items\":[" + summary("active", null) + "],\"nextIslandId\":\""
                + ISLAND + "\"}"));
        MvcResult result = mockMvc.perform(auth(get("/screens/explore")).param("q", "모래"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.memberships.items[0].id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.islands.nextCursor").isNotEmpty())
                .andReturn();
        assertKeys(result, "islands", "memberships");
        assertThat(DATA.hits(DATA_DISCOVER)).isZero();
        assertThat(DATA.receivedFor(DATA_SEARCH).get(0).query()).contains("limit=20");

        // B10 — 다음 페이지는 도메인 GET 이 같은 cursor 로 이어받는다.
        String cursor = JsonPath.read(result.getResponse().getContentAsString(), "$.data.islands.nextCursor");
        mockMvc.perform(auth(get("/islands")).param("q", "모래").param("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_SEARCH).get(1).query()).contains("cursorIslandId=" + ISLAND);
    }

    @Test
    void requiredFragmentFailureFailsTheWholeScreen() throws Exception {
        memberships(true);
        DATA.on(DATA_SEARCH, request -> domainError(403, "OBSERVATORY_LOCKED"));
        mockMvc.perform(auth(get("/screens/explore")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));

        // 소속 조회 실패를 미소속으로 바꾸지 않는다 — 두 번째 단계로 가지 않는다.
        DATA.reset();
        DATA.on(DATA_MINE, request -> ok(""));
        mockMvc.perform(auth(get("/screens/explore")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(DATA.hits(DATA_SEARCH) + DATA.hits(DATA_DISCOVER)).isZero();
    }

    @Test
    void rejectsDuplicateOrUnknownQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/explore")).param("q", "a", "b"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("q"));
        mockMvc.perform(auth(get("/screens/explore")).param("limit", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("limit"));
        assertThat(DATA.received()).isEmpty();
    }
}

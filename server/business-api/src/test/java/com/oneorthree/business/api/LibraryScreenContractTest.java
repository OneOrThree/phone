package com.oneorthree.business.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/library} 계약 (GROMO-1898) — 섬 문맥 뒤 도서관 완공 판정(건설 옵션). 미완공은 기록 조각만
 * N({@code statisticsAvailability:facility_locked})이고 화면은 200 이다. 기록 GET(티켓 1769)이 아직 없어 완공이면
 * 두 기록 조각이 missingFragments 다.
 */
class LibraryScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
    }

    @Test
    @DisplayName("도서관 완공: 기록 조각은 null + missingFragments, availability 는 위장하지 않고 null")
    void libraryBuiltButStatisticsMissing() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("mail")));

        MvcResult result = mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.statisticsAvailability").value(nullValue()))
                .andExpect(jsonPath("$.data.focusStatistics").value(nullValue()))
                .andExpect(jsonPath("$.data.missingFragments[0]").value("focusStatistics"))
                .andExpect(jsonPath("$.data.missingFragments[1]").value("screenTimeStatistics"))
                .andReturn();

        assertKeys(result, "island", "focusStatistics", "screenTimeStatistics", "statisticsAvailability",
                "missingFragments");
    }

    @Test
    @DisplayName("도서관 미완공: 기록 조각 null + facility_locked, 화면은 200 (B03 N)")
    void libraryLockedIsFragmentLevel() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("library", "mail")));

        MvcResult result = mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.statisticsAvailability").value("facility_locked"))
                .andExpect(jsonPath("$.data.focusStatistics").value(nullValue()))
                .andExpect(jsonPath("$.data.screenTimeStatistics").value(nullValue()))
                .andReturn();

        assertKeys(result, "island", "focusStatistics", "screenTimeStatistics", "statisticsAvailability");
    }

    @Test
    @DisplayName("완공 판정(건설 옵션)의 도메인 403 은 화면 전체 403 — N 으로 접지 않는다")
    void facilityCheckForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_OPTIONS, request -> domainError(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    @DisplayName("query 는 받지 않는다 — 400, 상류 호출 없음")
    void rejectsAnyQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/library")).queryParam("from", "2026-09-01"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }
}

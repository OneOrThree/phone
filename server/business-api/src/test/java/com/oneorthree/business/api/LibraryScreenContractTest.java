package com.oneorthree.business.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import com.oneorthree.business.common.time.WeekAxis;

import java.time.Instant;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/library} 계약 (GROMO-1898·1769) — 섬 문맥 뒤 도서관 완공 판정(건설 옵션). 미완공은 기록 조각만
 * N({@code statisticsAvailability:facility_locked})이고 화면은 200 이다. 완공이면 이번 UTC 주(일~토, 랭킹과 같은 7일)·scope=me 의 집중·스크린타임
 * 통계 조각을 싣는다.
 */
class LibraryScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";
    private static final String DATA_FOCUS = DATA_ISLAND + "/statistics/focus";
    private static final String DATA_SCREEN = DATA_ISLAND + "/statistics/screen-time";
    /** 주 경계 정본은 {@link WeekAxis} 한 곳뿐이다 — 랭킹과 같은 UTC 일요일 시작이다(GROMO-2048). */
    private static final LocalDate WEEK_START = WeekAxis.weekStart(Instant.now());

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
    }

    @Test
    @DisplayName("도서관 완공: 이번 UTC 주(일요일 시작)·scope=me 집중·스크린타임 통계를 병렬로 싣고 availability 는 available")
    void libraryBuiltCarriesStatistics() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("mail")));
        DATA.on(DATA_FOCUS, request -> ok("{\"scope\":\"me\",\"totalSeconds\":1500,\"series\":[{\"date\":\""
                + WEEK_START + "\",\"seconds\":1500}],\"records\":[],\"members\":null,"
                + "\"asOf\":\"2026-09-19T09:10:00Z\",\"nextSnapshotId\":null,\"nextOffset\":null}"));
        DATA.on(DATA_SCREEN, request -> ok("{\"scope\":\"me\",\"measurementStatus\":\"unavailable\","
                + "\"totalMinutes\":null,\"series\":[],\"updatedAt\":null,\"members\":null}"));

        MvcResult result = mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.statisticsAvailability").value("available"))
                .andExpect(jsonPath("$.data.focusStatistics.totalSeconds").value(1500))
                .andExpect(jsonPath("$.data.focusStatistics.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.screenTimeStatistics.measurementStatus").value("unavailable"))
                .andExpect(jsonPath("$.data.screenTimeStatistics.totalMinutes").value(nullValue()))
                .andReturn();

        assertKeys(result, "island", "focusStatistics", "screenTimeStatistics", "statisticsAvailability");
        String[] week = {"from=" + WEEK_START, "to=" + WEEK_START.plusDays(6), "scope=me"};
        assertThat(DATA.receivedFor(DATA_FOCUS).get(0).query().split("&")).containsExactlyInAnyOrder(week);
        assertThat(DATA.receivedFor(DATA_SCREEN).get(0).query().split("&")).containsExactlyInAnyOrder(week);
    }

    @Test
    @DisplayName("통계 조각의 도메인 403(LIBRARY_LOCKED) 은 화면 전체 실패다 — N 으로 접지 않는다")
    void statisticsFailureFailsWholeScreen() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("mail")));
        DATA.on(DATA_FOCUS, request -> domainError(403, "LIBRARY_LOCKED"));
        DATA.on(DATA_SCREEN, request -> domainError(403, "LIBRARY_LOCKED"));

        mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
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

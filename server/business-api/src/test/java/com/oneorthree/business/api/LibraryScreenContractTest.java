package com.oneorthree.business.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/library} 계약 (GROMO-1898·1769) — 섬 문맥 뒤 도서관 완공 판정(건설 옵션). 미완공은 기록 조각만
 * N({@code statisticsAvailability:facility_locked})이고 화면은 200 이다. 완공이면 이번 UTC 주·scope=me 의 집중·스크린타임
 * 통계 조각을 싣는다.
 */
class LibraryScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";
    private static final String DATA_FOCUS = DATA_ISLAND + "/statistics/focus";
    private static final String DATA_SCREEN = DATA_ISLAND + "/statistics/screen-time";
    private static final String DATA_FISH = DATA_ISLAND + "/statistics/fish-earnings";
    private static final LocalDate MONDAY = LocalDate.now(ZoneOffset.UTC).with(DayOfWeek.MONDAY);

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
    }

    @Test
    @DisplayName("도서관 완공: 이번 UTC 주·scope=me 집중·스크린타임 통계를 병렬로 싣고 availability 는 available")
    void libraryBuiltCarriesStatistics() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("mail")));
        DATA.on(DATA_FOCUS, request -> ok("{\"scope\":\"me\",\"totalSeconds\":1500,\"series\":[{\"date\":\""
                + MONDAY + "\",\"seconds\":1500}],\"records\":[],\"members\":null,"
                + "\"asOf\":\"2026-09-19T09:10:00Z\",\"nextSnapshotId\":null,\"nextOffset\":null}"));
        DATA.on(DATA_SCREEN, request -> ok("{\"scope\":\"me\",\"measurementStatus\":\"unavailable\","
                + "\"totalMinutes\":null,\"series\":[],\"updatedAt\":null,\"members\":null}"));
        DATA.on(DATA_FISH, request -> ok("{\"members\":[{\"userId\":\"" + ISLAND + "\",\"name\":\"수빈\","
                + "\"earnedFish\":4800}]}"));

        MvcResult result = mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.statisticsAvailability").value("available"))
                .andExpect(jsonPath("$.data.focusStatistics.totalSeconds").value(1500))
                .andExpect(jsonPath("$.data.focusStatistics.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.screenTimeStatistics.measurementStatus").value("unavailable"))
                .andExpect(jsonPath("$.data.screenTimeStatistics.totalMinutes").value(nullValue()))
                .andExpect(jsonPath("$.data.fishEarnings.members[0].earnedFish").value(4800))
                .andReturn();

        assertKeys(result, "island", "focusStatistics", "screenTimeStatistics", "fishEarnings",
                "statisticsAvailability");
        String[] week = {"from=" + MONDAY, "to=" + MONDAY.plusDays(6), "scope=me"};
        assertThat(DATA.receivedFor(DATA_FOCUS).get(0).query().split("&")).containsExactlyInAnyOrder(week);
        assertThat(DATA.receivedFor(DATA_SCREEN).get(0).query().split("&")).containsExactlyInAnyOrder(week);
        // 물고기 장은 전 기간 누적이라 주 경계를 안 탄다.
        assertThat(DATA.receivedFor(DATA_FISH).get(0).query()).isNullOrEmpty();
    }

    @Test
    @DisplayName("물고기 장 조각의 도메인 403 도 화면 전체 실패다 — 빈 명단으로 접지 않는다")
    void fishEarningsFailureFailsWholeScreen() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("mail")));
        DATA.on(DATA_FOCUS, request -> ok("{\"scope\":\"me\",\"totalSeconds\":0,\"series\":[],\"records\":[],"
                + "\"members\":null,\"asOf\":\"2026-09-19T09:10:00Z\",\"nextSnapshotId\":null,\"nextOffset\":null}"));
        DATA.on(DATA_SCREEN, request -> ok("{\"scope\":\"me\",\"measurementStatus\":\"unavailable\","
                + "\"totalMinutes\":null,\"series\":[],\"updatedAt\":null,\"members\":null}"));
        DATA.on(DATA_FISH, request -> domainError(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    @DisplayName("통계 조각의 도메인 403(LIBRARY_LOCKED) 은 화면 전체 실패다 — N 으로 접지 않는다")
    void statisticsFailureFailsWholeScreen() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("mail")));
        DATA.on(DATA_FOCUS, request -> domainError(403, "LIBRARY_LOCKED"));
        DATA.on(DATA_SCREEN, request -> domainError(403, "LIBRARY_LOCKED"));
        // 완공 판정과 조각 사이에 도서관이 헐린 경합 — 세 조각이 같은 게이트를 함께 맞는다.
        DATA.on(DATA_FISH, request -> domainError(403, "LIBRARY_LOCKED"));

        mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @Test
    @DisplayName("도서관 미완공: 기록·물고기 조각 null + facility_locked, 화면은 200 (B03 N)")
    void libraryLockedIsFragmentLevel() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("library", "mail")));

        MvcResult result = mockMvc.perform(auth(get("/screens/library")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.statisticsAvailability").value("facility_locked"))
                .andExpect(jsonPath("$.data.focusStatistics").value(nullValue()))
                .andExpect(jsonPath("$.data.screenTimeStatistics").value(nullValue()))
                .andExpect(jsonPath("$.data.fishEarnings").value(nullValue()))
                .andReturn();

        assertKeys(result, "island", "focusStatistics", "screenTimeStatistics", "fishEarnings",
                "statisticsAvailability");
        // 미완공이면 물고기 장을 부를 일이 없다(B03 — N 은 호출 자체를 생략한다).
        assertThat(DATA.receivedFor(DATA_FISH)).isEmpty();
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

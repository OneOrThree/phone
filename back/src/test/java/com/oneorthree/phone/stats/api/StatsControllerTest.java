package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = StatsController.class)
class StatsControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private StatsService statsService;

    @Test
    @DisplayName("히트맵 조회 → 200, 셀 배열")
    void getHeatmapReturns200() throws Exception {
        given(statsService.getHeatmap(any(), any(), any()))
                .willReturn(List.of(
                        new HeatmapCellResponse(LocalDate.of(2026, 6, 1), 0, 0, false, 0, false),
                        new HeatmapCellResponse(LocalDate.of(2026, 6, 2), 120, 2, true, 30, false)));

        mockMvc.perform(get("/api/v1/stats/heatmap")
                        .param("from", "2026-06-01")
                        .param("to", "2026-06-02"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].date").value("2026-06-01"))
                .andExpect(jsonPath("$[1].totalFocusMinutes").value(120))
                .andExpect(jsonPath("$[1].focusGoalAchieved").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("히트맵 조회 - from 누락 → 400")
    void getHeatmapMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/heatmap")
                        .param("to", "2026-06-02"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("스트릭 조회 → 200")
    void getStreakReturns200() throws Exception {
        given(statsService.getStreak(any()))
                .willReturn(new StreakResponse(5, 10, LocalDate.of(2026, 6, 28)));

        mockMvc.perform(get("/api/v1/stats/streak"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStreak").value(5))
                .andExpect(jsonPath("$.longestStreak").value(10))
                .andExpect(jsonPath("$.lastSessionDate").value("2026-06-28"))
                .andDo(print());
    }

    @Test
    @DisplayName("오늘 요약 조회 → 200, focus/screenTime 블록")
    void getTodayStatsReturns200() throws Exception {
        given(statsService.getTodayStats(any()))
                .willReturn(new TodayStatsResponse(
                        new TodayStatsResponse.FocusStat(45, 60, false, 75),
                        new TodayStatsResponse.ScreenTimeStat(80, 120, true, 67)));

        mockMvc.perform(get("/api/v1/stats/today"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.focus.todayMinutes").value(45))
                .andExpect(jsonPath("$.focus.progressPercent").value(75))
                .andExpect(jsonPath("$.screenTime.goalAchieved").value(true))
                .andExpect(jsonPath("$.screenTime.progressPercent").value(67))
                .andDo(print());
    }

    // ── getFocusStatsByPeriod ─────────────────────────────────────────────

    @Test
    @DisplayName("기간별 통계 ?period=day → 200, 응답 필드 존재")
    void getFocusStatsByPeriodDayReturns200() throws Exception {
        given(statsService.getFocusStatsByPeriod(any(), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90, 60, 30));

        mockMvc.perform(get("/api/v1/stats/focus").param("period", "day"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.from").value("2026-07-03"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(90))
                .andExpect(jsonPath("$.previousTotalFocusMinutes").value(60))
                .andExpect(jsonPath("$.deltaMinutes").value(30))
                .andDo(print());
    }

    @Test
    @DisplayName("기간별 통계 ?period=week → 200")
    void getFocusStatsByPeriodWeekReturns200() throws Exception {
        given(statsService.getFocusStatsByPeriod(any(), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29),
                        LocalDate.of(2026, 7, 3),
                        200, 150, 50));

        mockMvc.perform(get("/api/v1/stats/focus").param("period", "week"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("WEEK"))
                .andExpect(jsonPath("$.from").value("2026-06-29"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(200))
                .andExpect(jsonPath("$.previousTotalFocusMinutes").value(150))
                .andExpect(jsonPath("$.deltaMinutes").value(50))
                .andDo(print());
    }

    @Test
    @DisplayName("기간별 통계 ?period=month → 200")
    void getFocusStatsByPeriodMonthReturns200() throws Exception {
        given(statsService.getFocusStatsByPeriod(any(), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1),
                        LocalDate.of(2026, 7, 3),
                        120, 100, 20));

        mockMvc.perform(get("/api/v1/stats/focus").param("period", "month"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("MONTH"))
                .andExpect(jsonPath("$.from").value("2026-07-01"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(120))
                .andExpect(jsonPath("$.previousTotalFocusMinutes").value(100))
                .andExpect(jsonPath("$.deltaMinutes").value(20))
                .andDo(print());
    }

    @Test
    @DisplayName("기간별 통계 ?period=invalid → 400")
    void getFocusStatsByPeriodInvalidValueReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/focus").param("period", "invalid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("기간별 통계 period 파라미터 누락 → 400")
    void getFocusStatsByPeriodMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/focus"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // ── getScreenTimePeriodStats ──────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 기간별 통계 ?period=day → 200, day 전용 필드(goalAchieved) + achievedDays/totalDays=null")
    void getScreenTimePeriodStatsDayReturns200() throws Exception {
        given(statsService.getScreenTimePeriodStats(any(), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        80, 100, -20, 120, true, null, null));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("period", "day"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.from").value("2026-07-03"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.currentMinutes").value(80))
                .andExpect(jsonPath("$.previousMinutes").value(100))
                .andExpect(jsonPath("$.deltaMinutes").value(-20))
                .andExpect(jsonPath("$.goalMinutes").value(120))
                .andExpect(jsonPath("$.goalAchieved").value(true))
                .andExpect(jsonPath("$.achievedDays").doesNotExist())
                .andExpect(jsonPath("$.totalDays").doesNotExist())
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 기간별 통계 ?period=week → 200, achievedDays·totalDays 존재, goalAchieved=null")
    void getScreenTimePeriodStatsWeekReturns200() throws Exception {
        given(statsService.getScreenTimePeriodStats(any(), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29),
                        LocalDate.of(2026, 7, 3),
                        270, 160, 110, 100, null, 2, 5));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("period", "week"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("WEEK"))
                .andExpect(jsonPath("$.from").value("2026-06-29"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.currentMinutes").value(270))
                .andExpect(jsonPath("$.previousMinutes").value(160))
                .andExpect(jsonPath("$.deltaMinutes").value(110))
                .andExpect(jsonPath("$.goalAchieved").doesNotExist())
                .andExpect(jsonPath("$.achievedDays").value(2))
                .andExpect(jsonPath("$.totalDays").value(5))
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 기간별 통계 ?period=month → 200")
    void getScreenTimePeriodStatsMonthReturns200() throws Exception {
        given(statsService.getScreenTimePeriodStats(any(), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1),
                        LocalDate.of(2026, 7, 3),
                        200, 0, 200, 0, null, 1, 3));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("period", "month"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("MONTH"))
                .andExpect(jsonPath("$.from").value("2026-07-01"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.currentMinutes").value(200))
                .andExpect(jsonPath("$.achievedDays").value(1))
                .andExpect(jsonPath("$.totalDays").value(3))
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 기간별 통계 ?period=INVALID → 400")
    void getScreenTimePeriodStatsInvalidValueReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/screen-time").param("period", "INVALID"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 기간별 통계 period 누락 → 400")
    void getScreenTimePeriodStatsMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/screen-time"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }
}

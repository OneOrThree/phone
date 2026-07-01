package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
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
}

package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.stats.service.StatsService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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
                .andExpect(jsonPath("$.elapsedDays").doesNotExist())
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
                .andExpect(jsonPath("$.elapsedDays").value(5))
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
                .andExpect(jsonPath("$.elapsedDays").value(3))
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

    // ── getFocusStatsByCategory ───────────────────────────────────────────

    @Test
    @DisplayName("카테고리별 통계 ?period=day → 200, 응답 필드 존재")
    void getFocusStatsByCategoryDayReturns200() throws Exception {
        given(statsService.getFocusStatsByCategory(any(), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90,
                        List.of(new CategoryFocusStatsResponse.CategoryItem(
                                java.util.UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001"),
                                "공부", 90))));

        mockMvc.perform(get("/api/v1/stats/by-category").param("period", "day"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.from").value("2026-07-03"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(90))
                .andExpect(jsonPath("$.items").isArray())
                .andDo(print());
    }

    @Test
    @DisplayName("카테고리별 통계 ?period=week → 200")
    void getFocusStatsByCategoryWeekReturns200() throws Exception {
        given(statsService.getFocusStatsByCategory(any(), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29),
                        LocalDate.of(2026, 7, 3),
                        200,
                        List.of()));

        mockMvc.perform(get("/api/v1/stats/by-category").param("period", "week"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("WEEK"))
                .andExpect(jsonPath("$.from").value("2026-06-29"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(200))
                .andExpect(jsonPath("$.items").isArray())
                .andDo(print());
    }

    @Test
    @DisplayName("카테고리별 통계 ?period=month → 200")
    void getFocusStatsByCategoryMonthReturns200() throws Exception {
        given(statsService.getFocusStatsByCategory(any(), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1),
                        LocalDate.of(2026, 7, 3),
                        300,
                        List.of()));

        mockMvc.perform(get("/api/v1/stats/by-category").param("period", "month"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("MONTH"))
                .andExpect(jsonPath("$.from").value("2026-07-01"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(300))
                .andExpect(jsonPath("$.items").isArray())
                .andDo(print());
    }

    @Test
    @DisplayName("카테고리별 통계 ?period=invalid → 400")
    void getFocusStatsByCategoryInvalidValueReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/by-category").param("period", "invalid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("카테고리별 통계 period 파라미터 누락 → 400")
    void getFocusStatsByCategoryMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/by-category"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // friends 패스스루 — /stats/by-category (GROMO-624)

    @Test
    @DisplayName("친구 통계 — /stats/by-category ?friends={id} 바인딩·전달 후 대상 카테고리 통계 반환 → 200")
    void getFocusStatsByCategoryWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId))).willReturn(friendId);
        given(statsService.getFocusStatsByCategory(eq(friendId), eq(StatsPeriod.DAY)))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90,
                        List.of(new CategoryFocusStatsResponse.CategoryItem(
                                UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001"),
                                "공부", 90))));

        mockMvc.perform(get("/api/v1/stats/by-category")
                        .param("period", "day")
                        .param("friends", friendId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(90))
                .andExpect(jsonPath("$.items").isArray())
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — /stats/by-category 열람 권한 없음(비친구·비공개, NOT_FRIEND) → 404 (GROMO-623/624)")
    void getFocusStatsByCategoryWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/by-category")
                        .param("period", "day")
                        .param("friends", friendId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    // ── friends 파라미터 (친구 통계, GROMO-608) ────────────────────────────

    @Test
    @DisplayName("친구 통계 — ?friends={id} 지정 시 대상 결정 후 해당 대상 스트릭 반환 → 200")
    void getStreakWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        // caller 는 JwtFilter 미적용 슬라이스라 null → resolveTargetUserId(null, friendId) 가 대상 결정
        given(statsService.resolveTargetUserId(isNull(), eq(friendId))).willReturn(friendId);
        given(statsService.getStreak(friendId))
                .willReturn(new StreakResponse(3, 7, LocalDate.of(2026, 7, 5)));

        mockMvc.perform(get("/api/v1/stats/streak").param("friends", friendId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStreak").value(3))
                .andExpect(jsonPath("$.longestStreak").value(7))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — 친구관계 아님(NOT_FRIEND) → 404")
    void getStreakWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/streak").param("friends", friendId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — ?friends 형식 오류(UUID 아님) → 400")
    void getStreakWithFriendsInvalidUuidReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/streak").param("friends", "not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // friends 패스스루 — /stats/today

    @Test
    @DisplayName("친구 통계 — /stats/today ?friends={id} 바인딩·전달 후 대상 오늘 요약 반환 → 200")
    void getTodayStatsWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId))).willReturn(friendId);
        given(statsService.getTodayStats(friendId))
                .willReturn(new TodayStatsResponse(
                        new TodayStatsResponse.FocusStat(45, 60, false, 75),
                        new TodayStatsResponse.ScreenTimeStat(80, 120, true, 67)));

        mockMvc.perform(get("/api/v1/stats/today").param("friends", friendId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.focus.todayMinutes").value(45))
                .andExpect(jsonPath("$.screenTime.goalAchieved").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — /stats/today 친구관계 아님(NOT_FRIEND) → 404")
    void getTodayStatsWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/today").param("friends", friendId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    // friends 패스스루 — /stats/focus

    @Test
    @DisplayName("친구 통계 — /stats/focus ?friends={id} 바인딩·전달 후 대상 기간별 통계 반환 → 200")
    void getFocusStatsByPeriodWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId))).willReturn(friendId);
        given(statsService.getFocusStatsByPeriod(eq(friendId), eq(StatsPeriod.DAY)))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90, 60, 30));

        mockMvc.perform(get("/api/v1/stats/focus")
                        .param("period", "day")
                        .param("friends", friendId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(90))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — /stats/focus 친구관계 아님(NOT_FRIEND) → 404")
    void getFocusStatsByPeriodWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/focus")
                        .param("period", "day")
                        .param("friends", friendId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    // friends 패스스루 — /stats/screen-time

    @Test
    @DisplayName("친구 통계 — /stats/screen-time ?friends={id} 바인딩·전달 후 대상 통계 반환 → 200")
    void getScreenTimePeriodStatsWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId))).willReturn(friendId);
        given(statsService.getScreenTimePeriodStats(eq(friendId), eq(StatsPeriod.DAY)))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        80, 100, -20, 120, true, null, null));

        mockMvc.perform(get("/api/v1/stats/screen-time")
                        .param("period", "day")
                        .param("friends", friendId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.currentMinutes").value(80))
                .andExpect(jsonPath("$.goalAchieved").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — /stats/screen-time 친구관계 아님(NOT_FRIEND) → 404")
    void getScreenTimePeriodStatsWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(isNull(), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/screen-time")
                        .param("period", "day")
                        .param("friends", friendId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }
}

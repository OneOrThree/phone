package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.stats.StatsController;
import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusAverageResponse;
import com.oneorthree.phone.stats.dto.FocusAverageScope;
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
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = StatsController.class)
class StatsControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");

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
                        .param("to", "2026-06-02")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
    @DisplayName("스트릭 조회 → 200 (GROMO-847: date required)")
    void getStreakReturns200() throws Exception {
        given(statsService.getStreak(any(), any()))
                .willReturn(new StreakResponse(5, 10, LocalDate.of(2026, 6, 28)));

        mockMvc.perform(get("/api/v1/stats/streak").param("date", "2026-07-16")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStreak").value(5))
                .andExpect(jsonPath("$.longestStreak").value(10))
                .andExpect(jsonPath("$.lastSessionDate").value("2026-06-28"))
                .andDo(print());
    }

    @Test
    @DisplayName("스트릭 조회 - date 누락 → 400 (GROMO-847)")
    void getStreakMissingDateReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/streak"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("오늘 요약 조회 → 200, focus/screenTime 블록")
    void getTodayStatsReturns200() throws Exception {
        given(statsService.getTodayStats(any(), any(), any()))
                .willReturn(new TodayStatsResponse(
                        new TodayStatsResponse.FocusStat(45, 60, false, 75),
                        new TodayStatsResponse.ScreenTimeStat(80, 120, true, 67)));

        mockMvc.perform(get("/api/v1/stats/today").param("date", "2026-07-03")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getFocusStatsByPeriod(any(), any(), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90, 60, 30));

        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03").param("period", "day")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getFocusStatsByPeriod(any(), any(), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29),
                        LocalDate.of(2026, 7, 3),
                        200, 150, 50));

        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03").param("period", "week")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getFocusStatsByPeriod(any(), any(), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1),
                        LocalDate.of(2026, 7, 3),
                        120, 100, 20));

        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03").param("period", "month")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03").param("period", "invalid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("기간별 통계 period 파라미터 누락 → 400")
    void getFocusStatsByPeriodMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // ── getScreenTimePeriodStats ──────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 기간별 통계 ?period=day → 200, day 전용 필드(goalAchieved) + achievedDays/totalDays=null")
    void getScreenTimePeriodStatsDayReturns200() throws Exception {
        given(statsService.getScreenTimePeriodStats(any(), any(), any(), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        80, 100, -20, 120, true, null, null));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03").param("period", "day")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getScreenTimePeriodStats(any(), any(), any(), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29),
                        LocalDate.of(2026, 7, 3),
                        270, 160, 110, 100, null, 2, 5));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03").param("period", "week")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getScreenTimePeriodStats(any(), any(), any(), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1),
                        LocalDate.of(2026, 7, 3),
                        200, 0, 200, 0, null, 1, 3));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03").param("period", "month")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03").param("period", "INVALID"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 기간별 통계 period 누락 → 400")
    void getScreenTimePeriodStatsMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // ── getFocusStatsByCategory ───────────────────────────────────────────

    @Test
    @DisplayName("카테고리별 통계 ?period=day → 200, 응답 필드 존재")
    void getFocusStatsByCategoryDayReturns200() throws Exception {
        given(statsService.getFocusStatsByCategory(any(), any(), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90,
                        List.of(new CategoryFocusStatsResponse.CategoryItem(
                                java.util.UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001"),
                                "공부", 90))));

        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03").param("period", "day")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getFocusStatsByCategory(any(), any(), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29),
                        LocalDate.of(2026, 7, 3),
                        200,
                        List.of()));

        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03").param("period", "week")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.getFocusStatsByCategory(any(), any(), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1),
                        LocalDate.of(2026, 7, 3),
                        300,
                        List.of()));

        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03").param("period", "month")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03").param("period", "invalid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("카테고리별 통계 period 파라미터 누락 → 400")
    void getFocusStatsByCategoryMissingParamReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // friends 패스스루 — /stats/by-category (GROMO-624)

    @Test
    @DisplayName("친구 통계 — /stats/by-category ?friends={id} 바인딩·전달 후 대상 카테고리 통계 반환 → 200")
    void getFocusStatsByCategoryWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId))).willReturn(friendId);
        given(statsService.getFocusStatsByCategory(eq(friendId), eq(StatsPeriod.DAY), any()))
                .willReturn(new CategoryFocusStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90,
                        List.of(new CategoryFocusStatsResponse.CategoryItem(
                                UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001"),
                                "공부", 90))));

        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03")
                        .param("period", "day")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/by-category").param("date", "2026-07-03")
                        .param("period", "day")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId))).willReturn(friendId);
        given(statsService.getStreak(eq(friendId), any()))
                .willReturn(new StreakResponse(3, 7, LocalDate.of(2026, 7, 5)));

        mockMvc.perform(get("/api/v1/stats/streak")
                        .param("date", "2026-07-16")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStreak").value(3))
                .andExpect(jsonPath("$.longestStreak").value(7))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — 친구관계 아님(NOT_FRIEND) → 404")
    void getStreakWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/streak")
                        .param("date", "2026-07-16")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — ?friends 형식 오류(UUID 아님) → 400")
    void getStreakWithFriendsInvalidUuidReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/streak")
                        .param("date", "2026-07-16")
                        .param("friends", "not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // friends 패스스루 — /stats/today

    @Test
    @DisplayName("친구 통계 — /stats/today ?friends={id} 바인딩·전달 후 대상 오늘 요약 반환 → 200")
    void getTodayStatsWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId))).willReturn(friendId);
        given(statsService.getTodayStats(any(), eq(friendId), any()))
                .willReturn(new TodayStatsResponse(
                        new TodayStatsResponse.FocusStat(45, 60, false, 75),
                        new TodayStatsResponse.ScreenTimeStat(80, 120, true, 67)));

        mockMvc.perform(get("/api/v1/stats/today").param("date", "2026-07-03").param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.focus.todayMinutes").value(45))
                .andExpect(jsonPath("$.screenTime.goalAchieved").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — /stats/today 친구관계 아님(NOT_FRIEND) → 404")
    void getTodayStatsWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/today").param("date", "2026-07-03").param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    // friends 패스스루 — /stats/focus

    @Test
    @DisplayName("친구 통계 — /stats/focus ?friends={id} 바인딩·전달 후 대상 기간별 통계 반환 → 200")
    void getFocusStatsByPeriodWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId))).willReturn(friendId);
        given(statsService.getFocusStatsByPeriod(eq(friendId), eq(StatsPeriod.DAY), any()))
                .willReturn(new FocusPeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        90, 60, 30));

        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03")
                        .param("period", "day")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.totalFocusMinutes").value(90))
                .andDo(print());
    }

    @Test
    @DisplayName("친구 통계 — /stats/focus 친구관계 아님(NOT_FRIEND) → 404")
    void getFocusStatsByPeriodWithFriendsNotFriendReturns404() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/focus").param("date", "2026-07-03")
                        .param("period", "day")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    // friends 패스스루 — /stats/screen-time

    @Test
    @DisplayName("친구 통계 — /stats/screen-time ?friends={id} 바인딩·전달 후 대상 통계 반환 → 200")
    void getScreenTimePeriodStatsWithFriendsReturns200() throws Exception {
        UUID friendId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId))).willReturn(friendId);
        given(statsService.getScreenTimePeriodStats(any(), eq(friendId), eq(StatsPeriod.DAY), any()))
                .willReturn(new ScreenTimePeriodStatsResponse(
                        StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3),
                        LocalDate.of(2026, 7, 3),
                        80, 100, -20, 120, true, null, null));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03")
                        .param("period", "day")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
        given(statsService.resolveTargetUserId(eq(LOGIN_USER_ID), eq(friendId)))
                .willThrow(new FriendException(FriendErrorCode.NOT_FRIEND));

        mockMvc.perform(get("/api/v1/stats/screen-time").param("date", "2026-07-03")
                        .param("period", "day")
                        .param("friends", friendId.toString())
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FRIEND"))
                .andDo(print());
    }

    // ── getFocusAverage (GROMO-753) ───────────────────────────────────────

    @Test
    @DisplayName("평균 집중 ?scope=friends&period=day → 200, 응답 필드 존재 + enum 대문자 직렬화")
    void getFocusAverageFriendsDayReturns200() throws Exception {
        given(statsService.getFocusAverage(any(), eq(FocusAverageScope.FRIENDS), eq(StatsPeriod.DAY), any()))
                .willReturn(new FocusAverageResponse(
                        FocusAverageScope.FRIENDS, StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3), LocalDate.of(2026, 7, 3),
                        75, 2));

        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("scope", "friends")
                        .param("period", "day")
                        .param("date", "2026-07-03")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("FRIENDS"))
                .andExpect(jsonPath("$.period").value("DAY"))
                .andExpect(jsonPath("$.from").value("2026-07-03"))
                .andExpect(jsonPath("$.to").value("2026-07-03"))
                .andExpect(jsonPath("$.averageMinutes").value(75))
                .andExpect(jsonPath("$.sampleSize").value(2))
                .andDo(print());
    }

    @Test
    @DisplayName("평균 집중 ?scope=total&period=week → 200")
    void getFocusAverageTotalWeekReturns200() throws Exception {
        given(statsService.getFocusAverage(any(), eq(FocusAverageScope.TOTAL), eq(StatsPeriod.WEEK), any()))
                .willReturn(new FocusAverageResponse(
                        FocusAverageScope.TOTAL, StatsPeriod.WEEK,
                        LocalDate.of(2026, 6, 29), LocalDate.of(2026, 7, 3),
                        66, 3));

        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("scope", "total")
                        .param("period", "week")
                        .param("date", "2026-07-03")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("TOTAL"))
                .andExpect(jsonPath("$.period").value("WEEK"))
                .andExpect(jsonPath("$.from").value("2026-06-29"))
                .andExpect(jsonPath("$.averageMinutes").value(66))
                .andExpect(jsonPath("$.sampleSize").value(3))
                .andDo(print());
    }

    @Test
    @DisplayName("평균 집중 ?scope=category — occupation 미설정/무활동 → averageMinutes=null, sampleSize=0")
    void getFocusAverageCategoryNullReturns200WithNull() throws Exception {
        given(statsService.getFocusAverage(any(), eq(FocusAverageScope.CATEGORY), eq(StatsPeriod.MONTH), any()))
                .willReturn(new FocusAverageResponse(
                        FocusAverageScope.CATEGORY, StatsPeriod.MONTH,
                        LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 3),
                        null, 0));

        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("scope", "category")
                        .param("period", "month")
                        .param("date", "2026-07-03")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("CATEGORY"))
                .andExpect(jsonPath("$.averageMinutes").doesNotExist())
                .andExpect(jsonPath("$.sampleSize").value(0))
                .andDo(print());
    }

    @Test
    @DisplayName("평균 집중 — scope 대문자(FRIENDS)도 바인딩 → 200")
    void getFocusAverageUppercaseScopeBinds() throws Exception {
        given(statsService.getFocusAverage(any(), eq(FocusAverageScope.FRIENDS), eq(StatsPeriod.DAY), any()))
                .willReturn(new FocusAverageResponse(
                        FocusAverageScope.FRIENDS, StatsPeriod.DAY,
                        LocalDate.of(2026, 7, 3), LocalDate.of(2026, 7, 3),
                        30, 1));

        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("scope", "FRIENDS")
                        .param("period", "DAY")
                        .param("date", "2026-07-03")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("FRIENDS"))
                .andDo(print());
    }

    @Test
    @DisplayName("평균 집중 ?scope=invalid → 400")
    void getFocusAverageInvalidScopeReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("scope", "invalid")
                        .param("period", "day")
                        .param("date", "2026-07-03"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("평균 집중 — scope 파라미터 누락 → 400")
    void getFocusAverageMissingScopeReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("period", "day")
                        .param("date", "2026-07-03"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("평균 집중 — date 파라미터 누락 → 400")
    void getFocusAverageMissingDateReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/stats/focus/average")
                        .param("scope", "total")
                        .param("period", "day"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }
}

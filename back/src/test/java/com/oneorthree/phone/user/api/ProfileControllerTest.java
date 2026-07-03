package com.oneorthree.phone.user.api;

import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.service.ProfileService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = ProfileController.class)
class ProfileControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProfileService profileService;

    private final UUID targetUserId = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    @DisplayName("공개 프로필 조회 → 200, 닉네임·친구수·티어·랭킹 반환")
    void getPublicProfileReturns200() throws Exception {
        PublicProfileResponse response = new PublicProfileResponse(
                targetUserId, "조재영", List.of(), 5L, 3, 2);
        given(profileService.getPublicProfile(any())).willReturn(response);

        mockMvc.perform(get("/api/v1/users/{userId}/profile", targetUserId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(targetUserId.toString()))
                .andExpect(jsonPath("$.nickname").value("조재영"))
                .andExpect(jsonPath("$.friendCount").value(5))
                .andExpect(jsonPath("$.currentTier").value(3))
                .andExpect(jsonPath("$.rank").value(2))
                .andDo(print());
    }

    @Test
    @DisplayName("리그 미소속 → 200, tier/rank null")
    void getPublicProfileNoLeagueReturns200() throws Exception {
        PublicProfileResponse response = new PublicProfileResponse(
                targetUserId, "조재영", List.of(), 0L, null, null);
        given(profileService.getPublicProfile(any())).willReturn(response);

        mockMvc.perform(get("/api/v1/users/{userId}/profile", targetUserId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentTier").value(nullValue()))
                .andExpect(jsonPath("$.rank").value(nullValue()))
                .andDo(print());
    }

    @Test
    @DisplayName("존재하지 않는 userId → 404")
    void getPublicProfileNotFoundReturns404() throws Exception {
        given(profileService.getPublicProfile(any()))
                .willThrow(new UserException(UserErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/users/{userId}/profile", targetUserId))
                .andExpect(status().isNotFound())
                .andDo(print());
    }

    @Test
    @DisplayName("잘못된 UUID 형식 → 400")
    void getPublicProfileInvalidUuidReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/users/{userId}/profile", "not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // ──────────────────────────────────────────────────────────────────────
    // GET /api/v1/users/{userId}/stats (GROMO-521)
    // ──────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("통계 조회 - 친구O → 200, isFriend=true, today/heatmap 포함")
    void getUserStatsReturns200ForFriend() throws Exception {
        StreakResponse streak = new StreakResponse(7, 14, LocalDate.of(2026, 7, 1));
        TodayStatsResponse today = new TodayStatsResponse(
                new TodayStatsResponse.FocusStat(60, 90, false, 67),
                new TodayStatsResponse.ScreenTimeStat(30, 120, true, 25));
        HeatmapCellResponse cell = new HeatmapCellResponse(
                LocalDate.of(2026, 7, 1), 60, 1, false, 30, true);
        UserStatsResponse response = new UserStatsResponse(true, streak, today, List.of(cell));
        given(profileService.getUserStats(any(), any())).willReturn(response);

        mockMvc.perform(get("/api/v1/users/{userId}/stats", targetUserId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isFriend").value(true))
                .andExpect(jsonPath("$.streak.currentStreak").value(7))
                .andExpect(jsonPath("$.today.focus.todayMinutes").value(60))
                .andExpect(jsonPath("$.heatmap[0].totalFocusMinutes").value(60))
                .andDo(print());
    }

    @Test
    @DisplayName("통계 조회 - 친구X → 200, isFriend=false, today/heatmap null")
    void getUserStatsReturns200ForNonFriend() throws Exception {
        StreakResponse streak = new StreakResponse(3, 10, LocalDate.of(2026, 6, 30));
        UserStatsResponse response = new UserStatsResponse(false, streak, null, null);
        given(profileService.getUserStats(any(), any())).willReturn(response);

        mockMvc.perform(get("/api/v1/users/{userId}/stats", targetUserId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isFriend").value(false))
                .andExpect(jsonPath("$.streak.currentStreak").value(3))
                .andExpect(jsonPath("$.today").value(nullValue()))
                .andExpect(jsonPath("$.heatmap").value(nullValue()))
                .andDo(print());
    }

    @Test
    @DisplayName("통계 조회 - 존재하지 않는 userId → 404")
    void getUserStatsNotFoundReturns404() throws Exception {
        given(profileService.getUserStats(any(), any()))
                .willThrow(new UserException(UserErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/users/{userId}/stats", targetUserId))
                .andExpect(status().isNotFound())
                .andDo(print());
    }
}

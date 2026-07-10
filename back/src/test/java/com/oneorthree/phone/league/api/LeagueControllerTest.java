package com.oneorthree.phone.league.api;

import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.service.LeagueService;
import com.oneorthree.phone.user.domain.Occupation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = LeagueController.class)
class LeagueControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private LeagueService leagueService;

    @Test
    @DisplayName("내 티어 조회 → 200")
    void getMyTierReturns200() throws Exception {
        given(leagueService.getMyTier(any()))
                .willReturn(new LeagueTierResponse(true, 3, UUID.randomUUID(),
                        Instant.parse("2026-06-22T00:00:00Z"), "ACTIVE", "hyperfocus"));

        mockMvc.perform(get("/api/v1/league/me/tier"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(true))
                .andExpect(jsonPath("$.tierLevel").value(3))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.badgeId").value("hyperfocus"))
                .andDo(print());
    }

    @Test
    @DisplayName("내 티어 조회 - 미배정 → 200 assigned=false")
    void getMyTierUnassignedReturns200() throws Exception {
        given(leagueService.getMyTier(any()))
                .willReturn(new LeagueTierResponse(false, null, null, null, null, null));

        mockMvc.perform(get("/api/v1/league/me/tier"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(false))
                .andExpect(jsonPath("$.tierLevel").value(nullValue()))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회(category 미지정) → 200, rank 순서 배열")
    void getMyRankingReturns200() throws Exception {
        given(leagueService.getMyRanking(any(), any()))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "top", 3, 300, null, true),
                        new LeagueMemberResponse(2, UUID.randomUUID(), "me", 2, 200, null, false)));

        mockMvc.perform(get("/api/v1/league/me/ranking"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("top"))
                // 멤버별 tierLevel 노출 (GROMO-748)
                .andExpect(jsonPath("$[0].tierLevel").value(3))
                .andExpect(jsonPath("$[0].isPinned").value(true))
                .andExpect(jsonPath("$[1].rank").value(2))
                .andExpect(jsonPath("$[1].isPinned").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회(category=LABOR_ATTORNEY) → 200, 전역 같은 과목 랭킹")
    void getMyRankingWithCategoryReturns200() throws Exception {
        given(leagueService.getMyRanking(any(), eq(Occupation.LABOR_ATTORNEY)))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "global-top", 5, 500, null, false)));

        mockMvc.perform(get("/api/v1/league/me/ranking").param("category", "LABOR_ATTORNEY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("global-top"))
                .andExpect(jsonPath("$[0].isPinned").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회(category=잘못된값) → 400 INVALID_PARAMETER")
    void getMyRankingWithInvalidCategoryReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/league/me/ranking").param("category", "INVALID_OCCUPATION"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(scope=total) → 200, rank 순서 배열")
    void getGlobalRankingReturns200() throws Exception {
        given(leagueService.getGlobalRanking(eq("total"), eq(100)))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "global-top", 5, 900, null, false),
                        new LeagueMemberResponse(2, UUID.randomUUID(), "second", 4, 800, null, false)));

        mockMvc.perform(get("/api/v1/league/ranking").param("scope", "total"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("global-top"))
                .andExpect(jsonPath("$[1].rank").value(2))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(scope 미지정) → 200, 기본 total 적용")
    void getGlobalRankingDefaultScopeReturns200() throws Exception {
        given(leagueService.getGlobalRanking(eq("total"), eq(100)))
                .willReturn(List.of(new LeagueMemberResponse(1, UUID.randomUUID(), "top", 3, 900, null, false)));

        mockMvc.perform(get("/api/v1/league/ranking"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].nickname").value("top"))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(지원하지 않는 scope) → 400 INVALID_SCOPE")
    void getGlobalRankingInvalidScopeReturns400() throws Exception {
        given(leagueService.getGlobalRanking(eq("weekly"), eq(100)))
                .willThrow(new LeagueException(LeagueErrorCode.INVALID_SCOPE));

        mockMvc.perform(get("/api/v1/league/ranking").param("scope", "weekly"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SCOPE"))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(limit 비숫자) → 400 INVALID_PARAMETER")
    void getGlobalRankingInvalidLimitReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/league/ranking").param("limit", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
                .andDo(print());
    }

    @Test
    @DisplayName("내 순위 조회 → 200")
    void getMyRankReturns200() throws Exception {
        given(leagueService.getMyRank(any()))
                .willReturn(new LeagueRankResponse(true, 2, 200, null));

        mockMvc.perform(get("/api/v1/league/me/rank"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(true))
                .andExpect(jsonPath("$.myRank").value(2))
                .andDo(print());
    }

    @Test
    @DisplayName("리그 마감 스케줄 조회 → 200, nextResetAt·remainingSeconds 포함")
    void getMyScheduleReturns200() throws Exception {
        Instant nextReset = Instant.parse("2026-06-28T15:00:00Z");
        given(leagueService.getMySchedule(any()))
                .willReturn(new LeagueScheduleResponse(nextReset, 388800L));

        mockMvc.perform(get("/api/v1/league/me/schedule"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextResetAt").value("2026-06-28T15:00:00Z"))
                .andExpect(jsonPath("$.remainingSeconds").value(388800))
                .andDo(print());
    }
}

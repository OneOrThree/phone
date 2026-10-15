package com.oneorthree.phone.league.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.league.LeagueController;
import com.oneorthree.phone.league.dto.LeagueLastResultResponse;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.service.LeagueService;
import com.oneorthree.phone.user.repository.domain.Occupation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = LeagueController.class)
class LeagueControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private LeagueService leagueService;

    @Test
    @DisplayName("내 티어 조회 → 200")
    void getMyTierReturns200() throws Exception {
        given(leagueService.getMyTier(any()))
                .willReturn(new LeagueTierResponse(true, 3,
                        Instant.parse("2026-06-22T00:00:00Z"), "hyperfocus"));

        mockMvc.perform(get("/api/v1/league/me/tier")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(true))
                .andExpect(jsonPath("$.tierLevel").value(3))
                .andExpect(jsonPath("$.badgeId").value("hyperfocus"))
                .andDo(print());
    }

    @Test
    @DisplayName("내 티어 조회 - 미배정 → 200 assigned=false")
    void getMyTierUnassignedReturns200() throws Exception {
        given(leagueService.getMyTier(any()))
                .willReturn(new LeagueTierResponse(false, null, null, null));

        mockMvc.perform(get("/api/v1/league/me/tier")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(false))
                .andExpect(jsonPath("$.tierLevel").value(nullValue()))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회(category 미지정) → 200, rank 순서 배열 + 라이브 4필드")
    void getMyRankingReturns200() throws Exception {
        given(leagueService.getMyRanking(any(), any(), any()))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "top", 3, 300, true, true,
                                true, 42, Instant.parse("2026-06-24T01:00:00Z"), "전공 공부"),
                        new LeagueMemberResponse(2, UUID.randomUUID(), "me", 2, 200, false, false,
                                false, 0, null, null)));

        mockMvc.perform(get("/api/v1/league/me/ranking").param("date", "2026-06-24")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("top"))
                // 멤버별 tierLevel 노출 (GROMO-748)
                .andExpect(jsonPath("$[0].tierLevel").value(3))
                .andExpect(jsonPath("$[0].isPinned").value(true))
                // 조회자 기준 친구 여부 (GROMO-1630)
                .andExpect(jsonPath("$[0].isFriend").value(true))
                .andExpect(jsonPath("$[1].isFriend").value(false))
                // 라이브 4필드 (GROMO-824) — record 컴포넌트명 그대로 isFocusing 키 노출
                .andExpect(jsonPath("$[0].isFocusing").value(true))
                .andExpect(jsonPath("$[0].focusTimeMinutes").value(42))
                .andExpect(jsonPath("$[0].focusStartedAt").value("2026-06-24T01:00:00Z"))
                .andExpect(jsonPath("$[0].focusTagName").value("전공 공부"))
                .andExpect(jsonPath("$[1].rank").value(2))
                .andExpect(jsonPath("$[1].isPinned").value(false))
                .andExpect(jsonPath("$[1].isFocusing").value(false))
                .andExpect(jsonPath("$[1].focusTimeMinutes").value(0))
                .andExpect(jsonPath("$[1].focusStartedAt").value(nullValue()))
                .andExpect(jsonPath("$[1].focusTagName").value(nullValue()))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회(category=LABOR_ATTORNEY) → 200, 전역 같은 과목 랭킹, date 위임")
    void getMyRankingWithCategoryReturns200() throws Exception {
        given(leagueService.getMyRanking(any(), eq(Occupation.LABOR_ATTORNEY), eq(LocalDate.of(2026, 6, 24))))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "global-top", 5, 500, false, false,
                                false, 0, null, null)));

        mockMvc.perform(get("/api/v1/league/me/ranking")
                        .param("category", "LABOR_ATTORNEY")
                        .param("date", "2026-06-24")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("global-top"))
                .andExpect(jsonPath("$[0].isPinned").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회(category=잘못된값) → 400 INVALID_PARAMETER")
    void getMyRankingWithInvalidCategoryReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/league/me/ranking")
                        .param("category", "INVALID_OCCUPATION")
                        .param("date", "2026-06-24")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회 — date 누락 시 400 (required 계약)")
    void getMyRankingMissingDateReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/league/me/ranking")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(scope=total) → 200, rank 순서 배열")
    void getGlobalRankingReturns200() throws Exception {
        given(leagueService.getGlobalRanking(eq(LOGIN_USER_ID), eq("total"), eq(100)))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "global-top", 5, 900, false, true,
                                false, 0, null, null),
                        new LeagueMemberResponse(2, UUID.randomUUID(), "second", 4, 800, false, false,
                                false, 0, null, null)));

        mockMvc.perform(get("/api/v1/league/ranking").param("scope", "total")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("global-top"))
                // 전역에서도 isFriend 는 조회자(@LoginUser) 기준으로 채워진다 (GROMO-1630)
                .andExpect(jsonPath("$[0].isFriend").value(true))
                .andExpect(jsonPath("$[1].rank").value(2))
                .andExpect(jsonPath("$[1].isFriend").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(scope 미지정) → 200, 기본 total 적용")
    void getGlobalRankingDefaultScopeReturns200() throws Exception {
        given(leagueService.getGlobalRanking(eq(LOGIN_USER_ID), eq("total"), eq(100)))
                .willReturn(List.of(new LeagueMemberResponse(1, UUID.randomUUID(), "top", 3, 900, false, false,
                        false, 0, null, null)));

        mockMvc.perform(get("/api/v1/league/ranking")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].nickname").value("top"))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(지원하지 않는 scope) → 400 INVALID_SCOPE")
    void getGlobalRankingInvalidScopeReturns400() throws Exception {
        given(leagueService.getGlobalRanking(eq(LOGIN_USER_ID), eq("weekly"), eq(100)))
                .willThrow(new LeagueException(LeagueErrorCode.INVALID_SCOPE));

        mockMvc.perform(get("/api/v1/league/ranking").param("scope", "weekly")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SCOPE"))
                .andDo(print());
    }

    @Test
    @DisplayName("전역 랭킹 조회(limit 비숫자) → 400 INVALID_PARAMETER")
    void getGlobalRankingInvalidLimitReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/league/ranking").param("limit", "abc")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
                .andDo(print());
    }

    @Test
    @DisplayName("내 순위 조회 → 200")
    void getMyRankReturns200() throws Exception {
        given(leagueService.getMyRank(any()))
                .willReturn(new LeagueRankResponse(true, 2, 200));

        mockMvc.perform(get("/api/v1/league/me/rank")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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

        mockMvc.perform(get("/api/v1/league/me/schedule")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextResetAt").value("2026-06-28T15:00:00Z"))
                .andExpect(jsonPath("$.remainingSeconds").value(388800))
                .andDo(print());
    }

    @Test
    @DisplayName("주간 마감 결과 조회 → 200, 전체 필드 매핑")
    void getLastResultReturns200() throws Exception {
        given(leagueService.getLastResult(any()))
                .willReturn(new LeagueLastResultResponse(true,
                        Instant.parse("2026-06-15T00:00:00Z"), "PROMOTED", 2, 3, 50400, false, 100));

        mockMvc.perform(get("/api/v1/league/me/last-result")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasResult").value(true))
                .andExpect(jsonPath("$.weekStartAt").value("2026-06-15T00:00:00Z"))
                .andExpect(jsonPath("$.result").value("PROMOTED"))
                .andExpect(jsonPath("$.previousTierLevel").value(2))
                .andExpect(jsonPath("$.newTierLevel").value(3))
                .andExpect(jsonPath("$.focusSeconds").value(50400))
                .andExpect(jsonPath("$.acknowledged").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("주간 마감 결과 조회 - 결과 없음 → 200 hasResult=false, 나머지 필드 null/false")
    void getLastResultNoneReturns200() throws Exception {
        given(leagueService.getLastResult(any()))
                .willReturn(new LeagueLastResultResponse(false, null, null, null, null, null, false, 0));

        mockMvc.perform(get("/api/v1/league/me/last-result")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hasResult").value(false))
                .andExpect(jsonPath("$.weekStartAt").value(nullValue()))
                .andExpect(jsonPath("$.result").value(nullValue()))
                .andExpect(jsonPath("$.previousTierLevel").value(nullValue()))
                .andExpect(jsonPath("$.newTierLevel").value(nullValue()))
                .andExpect(jsonPath("$.focusSeconds").value(nullValue()))
                .andExpect(jsonPath("$.acknowledged").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("주간 마감 결과 확인(ack) → 200, body 의 weekStartAt 을 서비스에 위임")
    void acknowledgeLastResultReturns200() throws Exception {
        Instant weekStartAt = Instant.parse("2026-06-15T00:00:00Z");

        mockMvc.perform(post("/api/v1/league/me/last-result/ack")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"weekStartAt\":\"2026-06-15T00:00:00Z\"}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andDo(print());

        verify(leagueService).acknowledgeLastResult(any(), eq(weekStartAt));
    }
}

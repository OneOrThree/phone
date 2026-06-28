package com.oneorthree.phone.league.api;

import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.service.LeagueService;
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
                        Instant.parse("2026-06-22T00:00:00Z"), "ACTIVE"));

        mockMvc.perform(get("/api/v1/league/me/tier"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(true))
                .andExpect(jsonPath("$.tierLevel").value(3))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andDo(print());
    }

    @Test
    @DisplayName("내 티어 조회 - 미배정 → 200 assigned=false")
    void getMyTierUnassignedReturns200() throws Exception {
        given(leagueService.getMyTier(any()))
                .willReturn(new LeagueTierResponse(false, null, null, null, null));

        mockMvc.perform(get("/api/v1/league/me/tier"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assigned").value(false))
                .andExpect(jsonPath("$.tierLevel").value(nullValue()))
                .andDo(print());
    }

    @Test
    @DisplayName("랭킹 조회 → 200, rank 순서 배열")
    void getMyRankingReturns200() throws Exception {
        given(leagueService.getMyRanking(any()))
                .willReturn(List.of(
                        new LeagueMemberResponse(1, UUID.randomUUID(), "top", 300, null),
                        new LeagueMemberResponse(2, UUID.randomUUID(), "me", 200, null)));

        mockMvc.perform(get("/api/v1/league/me/ranking"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].nickname").value("top"))
                .andExpect(jsonPath("$[1].rank").value(2))
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
}

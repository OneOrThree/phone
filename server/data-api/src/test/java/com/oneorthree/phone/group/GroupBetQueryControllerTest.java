package com.oneorthree.phone.group;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.dto.GroupBetResultParticipantResponse;
import com.oneorthree.phone.group.dto.MyBetSessionResponse;
import com.oneorthree.phone.group.dto.MyBetSessionsResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultsResponse;
import com.oneorthree.phone.group.service.GroupBetQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 챌린지 v2 조회 축 컨트롤러(GROMO-1415)의 와이어 계약 — ① {@code /me/bet-sessions} 의 status
 * 필터는 OPEN 만 받는다(그 외 400 — 조용히 OPEN 으로 눙치면 앱 버그가 숨는다), ② 응답 봉투 키
 * ({@code sessions} / 최상위 {@code results} 안의 인별 {@code results})가 LLD §2.1 모양 그대로
 * 나가는지 잠근다.
 */
@WebMvcTest(controllers = GroupBetQueryController.class)
class GroupBetQueryControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GroupBetQueryService groupBetQueryService;

    @Test
    @DisplayName("GET /me/bet-sessions — status 생략·OPEN 은 200, 봉투 키 sessions 로 나간다")
    void myBetSessionsAcceptsOpenAndSerializesEnvelope() throws Exception {
        UUID sessionId = UUID.randomUUID();
        given(groupBetQueryService.getMyOpenBetSessions(eq(LOGIN_USER_ID)))
                .willReturn(new MyBetSessionsResponse(List.of(MyBetSessionResponse.builder()
                        .sessionId(sessionId)
                        .sessionDate(LocalDate.parse("2026-08-10"))
                        .missionCategory(MissionCategory.SCREEN_TIME)
                        .missionType(MissionType.TIME_WINDOW)
                        .goalMinutes(30)
                        .windowStart(LocalTime.of(22, 0))
                        .windowEnd(LocalTime.of(23, 59))
                        .closesAt(Instant.parse("2026-08-10T14:59:00Z"))
                        .settleAfter(Instant.parse("2026-08-10T15:29:00Z"))
                        .build())));

        mockMvc.perform(get("/api/v1/me/bet-sessions")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessions[0].sessionId").value(sessionId.toString()))
                .andExpect(jsonPath("$.sessions[0].missionCategory").value("SCREEN_TIME"))
                .andExpect(jsonPath("$.sessions[0].goalMinutes").value(30));

        mockMvc.perform(get("/api/v1/me/bet-sessions").param("status", "OPEN")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("GET /me/bet-sessions?status=SETTLED — 지원하지 않는 필터는 400, 서비스 미호출")
    void myBetSessionsRejectsUnsupportedStatus() throws Exception {
        mockMvc.perform(get("/api/v1/me/bet-sessions").param("status", "SETTLED")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_STATUS_FILTER"));

        verify(groupBetQueryService, never()).getMyOpenBetSessions(any());
    }

    @Test
    @DisplayName("GET /me/challenge-results — 최상위 results 봉투와 인별 results 가 중첩된 계약 모양으로 나간다")
    void myChallengeResultsSerializesNestedResults() throws Exception {
        UUID sessionId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        given(groupBetQueryService.getMyChallengeResults(eq(LOGIN_USER_ID), any(), any()))
                .willReturn(new MyChallengeResultsResponse(List.of(MyChallengeResultResponse.builder()
                        .sessionId(sessionId)
                        .groupName("새벽반")
                        .challengeDeleted(false)
                        .challengeEnded(true)
                        .sessionDate(LocalDate.parse("2026-08-08"))
                        .stake(30).pot(90)
                        .status(GroupBetStatus.SETTLED)
                        .goalMinutes(90)
                        .missionCategory(MissionCategory.FOCUS)
                        .missionType(MissionType.DURATION)
                        .myAchieved(true).myPayout(45)
                        .results(List.of(GroupBetResultParticipantResponse.builder()
                                .userId(userId).nickname("민지").achieved(true).payout(45)
                                .progressMinutes(102).build()))
                        .build())));

        mockMvc.perform(get("/api/v1/me/challenge-results")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results[0].sessionId").value(sessionId.toString()))
                .andExpect(jsonPath("$.results[0].challengeEnded").value(true))
                .andExpect(jsonPath("$.results[0].myPayout").value(45))
                .andExpect(jsonPath("$.results[0].results[0].nickname").value("민지"))
                .andExpect(jsonPath("$.results[0].results[0].progressMinutes").value(102));
    }
}

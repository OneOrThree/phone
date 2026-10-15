package com.oneorthree.phone.group;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupBetConfigResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.service.GroupBetWindowUsageService;
import com.oneorthree.phone.group.service.GroupChallengeService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 컨트롤러 분리(GROMO-1284) 후 <b>경로 불변</b> 잠금 — 챌린지 엔드포인트가 종전 URL 그대로 새
 * 컨트롤러에 매핑되는지, 창 사용분 보고가 종전과 <b>같은 서비스</b>(GroupBetWindowUsageService —
 * GROMO-1407 · N34)를 타는지, 그리고 신앱 additive 필드(GROMO-1418)의 null 직렬화(3상 계약)를
 * 와이어 레벨로 고정한다.
 */
@WebMvcTest(controllers = GroupChallengeController.class)
class GroupChallengeControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");
    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GroupChallengeService groupChallengeService;

    @MockitoBean
    private GroupBetWindowUsageService groupBetWindowUsageService;

    @Test
    @DisplayName("GET /groups/{gid}/challenges — 종전 URL 그대로 + additive 필드가 null 로도 키를 유지한다(3상)")
    void getChallengesKeepsUrlAndSerializesAdditiveNulls() throws Exception {
        GroupChallengeResponse challenge = GroupChallengeResponse.builder()
                .id(CHALLENGE_ID)
                .missionType(MissionType.DURATION)
                .missionCategory(MissionCategory.FOCUS)
                .durationMinutes(60)
                .status(GroupChallengeStatus.ACTIVE)
                .canParticipate(true)
                .bet(GroupBetResponse.builder()
                        .betId(UUID.fromString("00000000-0000-0000-0000-000000000003"))
                        .stake(30)
                        .pot(30)
                        .myJoined(true)
                        // 비활성 요일 등 오늘 회차 없음 — session 키는 null 로 실려야 한다.
                        .session(null)
                        .enabled(true)
                        .build())
                // 설정 축은 회차와 무관하게 실린다 — 신앱은 이걸로 진입점을 세운다.
                .betConfig(GroupBetConfigResponse.builder().enabled(true).stake(30).build())
                .nextSessionAt(null)
                .nextSessionJoined(null)
                .build();
        // 내기가 걸리지 않은 챌린지 — bet·betConfig 둘 다 null 키로 실려야 한다(3상).
        GroupChallengeResponse noBet = GroupChallengeResponse.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-000000000009"))
                .missionType(MissionType.DURATION)
                .missionCategory(MissionCategory.FOCUS)
                .status(GroupChallengeStatus.ACTIVE)
                .bet(null)
                .betConfig(null)
                .build();
        given(groupChallengeService.getChallenges(GROUP_ID, LOGIN_USER_ID, LocalDate.of(2026, 8, 10)))
                .willReturn(List.of(challenge, noBet));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", GROUP_ID)
                        .param("date", "2026-08-10")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(CHALLENGE_ID.toString()))
                .andExpect(jsonPath("$[0].bet.enabled").value(true))
                .andExpect(jsonPath("$[0].betConfig.enabled").value(true))
                .andExpect(jsonPath("$[0].betConfig.stake").value(30))
                // null 값 키의 "존재"는 jsonPath exists 로 못 잡는다 — 원문으로 잠근다(계약 §1 선례).
                .andExpect(content().string(containsString("\"session\":null")))
                .andExpect(content().string(containsString("\"nextSessionAt\":null")))
                .andExpect(content().string(containsString("\"nextSessionJoined\":null")))
                // betConfig 만은 반대다 — 진입점이 없으면 <b>키를 빼야</b> 한다. 앱 타입이
                // betConfig?: {...} 라 null 을 허용하지 않고, 카드가 undefined 만 걸러낸 뒤
                // betConfig.enabled 를 읽어 내기 없는 챌린지 하나에 그룹 화면 전체가 죽는다.
                .andExpect(content().string(not(containsString("\"betConfig\":null"))))
                // 값이 있을 때는 종전대로 실린다(위 betConfig.enabled 단정과 같은 축).
                .andExpect(jsonPath("$[1].betConfig").doesNotExist());
    }

    @Test
    @DisplayName("POST /groups/{gid}/challenges — 종전 URL 그대로 201")
    void createChallengeKeepsUrl() throws Exception {
        given(groupChallengeService.createChallenge(eq(GROUP_ID), eq(LOGIN_USER_ID), any()))
                .willReturn(CreateChallengeResponse.builder()
                        .id(CHALLENGE_ID)
                        .nonParticipants(List.of())
                        .build());

        mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", GROUP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"missionCategory\":\"FOCUS\",\"missionType\":\"DURATION\","
                                + "\"durationMinutes\":60}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(CHALLENGE_ID.toString()));
    }

    @Test
    @DisplayName("PUT /groups/{gid}/challenges/{cid}/window-usage — 종전 URL 그대로 204"
            + " + 신앱 payload {usageDate, progressMinutes, measuredAt} 바인딩")
    void reportWindowUsageKeepsUrlAndBindsNewFieldNames() throws Exception {
        mockMvc.perform(put("/api/v1/groups/{groupId}/challenges/{challengeId}/window-usage",
                        GROUP_ID, CHALLENGE_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"usageDate":"2026-08-10","progressMinutes":24,
                                 "measuredAt":"2026-08-10T14:03:00Z"}
                                """)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent());

        // 컨트롤러 분리(GROMO-1284) 후에도 호출 대상은 종전 그대로 창 사용분 전담 서비스다
        // (GROMO-1407 · N34) — 경로만 옮기고 배선을 바꾸면 measuredAt 단조 갱신이 통째로 빠진다.
        ArgumentCaptor<WindowUsageReportRequest> captor =
                ArgumentCaptor.forClass(WindowUsageReportRequest.class);
        verify(groupBetWindowUsageService).reportWindowUsage(eq(GROUP_ID), eq(CHALLENGE_ID),
                eq(LOGIN_USER_ID), captor.capture());
        assertThat(captor.getValue().getUsageDate()).isEqualTo(LocalDate.of(2026, 8, 10));
        assertThat(captor.getValue().getProgressMinutes()).isEqualTo(24);
        assertThat(captor.getValue().getMeasuredAt())
                .isEqualTo(java.time.Instant.parse("2026-08-10T14:03:00Z"));
    }

    @Test
    @DisplayName("창 사용분 보고 — 구앱 payload {date, usedMinutes} 도 같은 필드로 수용된다(브리지)")
    void reportWindowUsageBridgesLegacyFieldNames() throws Exception {
        mockMvc.perform(put("/api/v1/groups/{groupId}/challenges/{challengeId}/window-usage",
                        GROUP_ID, CHALLENGE_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"date":"2026-08-10","usedMinutes":90}
                                """)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent());

        ArgumentCaptor<WindowUsageReportRequest> captor =
                ArgumentCaptor.forClass(WindowUsageReportRequest.class);
        verify(groupBetWindowUsageService).reportWindowUsage(any(), any(), any(), captor.capture());
        assertThat(captor.getValue().getUsageDate()).isEqualTo(LocalDate.of(2026, 8, 10));
        assertThat(captor.getValue().getProgressMinutes()).isEqualTo(90);
        assertThat(captor.getValue().getMeasuredAt()).isNull();
    }

    @Test
    @DisplayName("DELETE /groups/{gid}/challenges/{cid} — 종전 URL 그대로 204")
    void deleteChallengeKeepsUrl() throws Exception {
        mockMvc.perform(delete("/api/v1/groups/{groupId}/challenges/{challengeId}",
                        GROUP_ID, CHALLENGE_ID)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent());

        verify(groupChallengeService).deleteChallenge(GROUP_ID, CHALLENGE_ID, LOGIN_USER_ID);
    }

    @Test
    @DisplayName("date 파라미터 미전달도 종전대로 통과한다 — 하위 호환 조회(구앱)")
    void getChallengesWithoutDateStillWorks() throws Exception {
        given(groupChallengeService.getChallenges(GROUP_ID, LOGIN_USER_ID, null))
                .willReturn(List.of());

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", GROUP_ID)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk());

        ArgumentCaptor<LocalDate> dateCaptor = ArgumentCaptor.forClass(LocalDate.class);
        verify(groupChallengeService).getChallenges(eq(GROUP_ID), eq(LOGIN_USER_ID), dateCaptor.capture());
        assertThat(dateCaptor.getValue()).isNull();
    }
}

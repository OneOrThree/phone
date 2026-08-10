package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupBetResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
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
 * 컨트롤러 분리(GROMO-1284) 후 <b>경로 불변</b> 잠금 — 4개 챌린지 엔드포인트가 종전 URL 그대로
 * 새 컨트롤러에 매핑되는지와, 신앱 additive 필드(GROMO-1418)의 null 직렬화(3상 계약)를 와이어
 * 레벨로 고정한다.
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
                .nextSessionAt(null)
                .nextSessionJoined(null)
                .build();
        given(groupChallengeService.getChallenges(GROUP_ID, LOGIN_USER_ID, LocalDate.of(2026, 8, 10)))
                .willReturn(List.of(challenge));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", GROUP_ID)
                        .param("date", "2026-08-10")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(CHALLENGE_ID.toString()))
                .andExpect(jsonPath("$[0].bet.enabled").value(true))
                // null 값 키의 "존재"는 jsonPath exists 로 못 잡는다 — 원문으로 잠근다(계약 §1 선례).
                .andExpect(content().string(containsString("\"session\":null")))
                .andExpect(content().string(containsString("\"nextSessionAt\":null")))
                .andExpect(content().string(containsString("\"nextSessionJoined\":null")));
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
    @DisplayName("PUT /groups/{gid}/challenges/{cid}/window-usage — 종전 URL 그대로 204")
    void reportWindowUsageKeepsUrl() throws Exception {
        mockMvc.perform(put("/api/v1/groups/{groupId}/challenges/{challengeId}/window-usage",
                        GROUP_ID, CHALLENGE_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-08-10\",\"usedMinutes\":42}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent());

        verify(groupChallengeService).reportWindowUsage(eq(GROUP_ID), eq(CHALLENGE_ID),
                eq(LOGIN_USER_ID), any());
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

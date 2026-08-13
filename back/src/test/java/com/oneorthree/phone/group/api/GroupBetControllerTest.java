package com.oneorthree.phone.group.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.dto.GroupBetHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.dto.GroupBetResultParticipantResponse;
import com.oneorthree.phone.group.dto.GroupBetResultResponse;
import com.oneorthree.phone.group.service.GroupBetJoinService;
import com.oneorthree.phone.group.service.GroupBetService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 내기 히스토리 API 의 와이어 계약 검증(GROMO-1207) — 정산 근거 필드가 <b>null 이어도 키가
 * 실리는지</b>가 핵심이다. 앱이 undefined(구서버)/null(근거 없음)/값의 3상을 구분하므로
 * {@code @JsonInclude(NON_NULL)} 이 붙는 순간 조용히 깨진다(계약 §1) — 와이어 레벨로 잠가둔다.
 */
@WebMvcTest(controllers = GroupBetController.class)
class GroupBetControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");
    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID BET_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");

    @Autowired
    private MockMvc mockMvc;

    /**
     * 회귀 단언용 로컬 매퍼 — WebMvcTest 슬라이스는 ObjectMapper 빈을 노출하지 않는다
     * (UserControllerTest 선례). NON_NULL 방어의 정본은 위 MockMvc 응답 원문 단언이고,
     * 이 매퍼는 컨트롤러를 거치지 않는 lastSettledBet DTO 의 형태만 본다.
     */
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @MockitoBean
    private GroupBetService groupBetService;

    // 신 참여 3종(GROMO-1408) 의존성 — 이 슬라이스의 기존 테스트는 호출하지 않지만 컨트롤러
    // 생성자가 요구한다.
    @MockitoBean
    private GroupBetJoinService groupBetJoinService;

    @Test
    @DisplayName("히스토리 응답 — 근거 없는(V29 이전) 정산 건도 goalMinutes·progressMinutes 키가 null 로 실린다")
    void serializesNullEvidenceFieldsInHistory() throws Exception {
        GroupBetHistoryItemResponse legacyItem = GroupBetHistoryItemResponse.builder()
                .betId(BET_ID)
                .betDate(LocalDate.of(2026, 7, 31))
                .stake(30)
                .pot(60)
                .status(GroupBetStatus.SETTLED)
                .settledAt(Instant.parse("2026-07-31T16:00:00Z"))
                .goalMinutes(null)
                .results(List.of(GroupBetResultParticipantResponse.builder()
                        .userId(LOGIN_USER_ID)
                        .nickname("재영")
                        .achieved(true)
                        .payout(60)
                        .progressMinutes(null)
                        .build()))
                .build();
        given(groupBetService.getBetHistory(eq(GROUP_ID), eq(CHALLENGE_ID), eq(LOGIN_USER_ID),
                isNull(), eq(20)))
                .willReturn(new GroupBetHistorySliceResponse(List.of(legacyItem), 20, false, null));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges/{challengeId}/bets", GROUP_ID, CHALLENGE_ID)
                        .param("size", "20")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].betId").value(BET_ID.toString()))
                .andExpect(jsonPath("$.content[0].settledAt").value("2026-07-31T16:00:00Z"))
                .andExpect(jsonPath("$.hasNext").value(false))
                // null 값 키의 "존재"는 jsonPath 로 못 잡는다(exists 는 non-null 단언) — 원문으로 잠근다.
                .andExpect(content().string(containsString("\"goalMinutes\":null")))
                .andExpect(content().string(containsString("\"progressMinutes\":null")))
                .andExpect(content().string(containsString("\"nextCursor\":null")));
    }

    @Test
    @DisplayName("cursor 파라미터가 서비스까지 그대로 전달된다")
    void passesCursorThrough() throws Exception {
        given(groupBetService.getBetHistory(any(), any(), any(), eq(BET_ID), eq(10)))
                .willReturn(new GroupBetHistorySliceResponse(List.of(), 10, false, null));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges/{challengeId}/bets", GROUP_ID, CHALLENGE_ID)
                        .param("cursor", BET_ID.toString())
                        .param("size", "10")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());
    }

    @Test
    @DisplayName("기존 결과 응답(lastSettledBet 의 GroupBetResultResponse)도 새 필드가 null 로 직렬화된다 — 회귀 방어")
    void serializesNullEvidenceFieldsInLastSettledResult() throws Exception {
        GroupBetResultResponse legacy = GroupBetResultResponse.builder()
                .betDate(LocalDate.of(2026, 7, 31))
                .stake(30)
                .pot(30)
                .status(GroupBetStatus.FORFEITED)
                .goalMinutes(null)
                .results(List.of(GroupBetResultParticipantResponse.builder()
                        .userId(LOGIN_USER_ID)
                        .nickname("재영")
                        .achieved(false)
                        .payout(0)
                        .progressMinutes(null)
                        .build()))
                .build();

        String json = objectMapper.writeValueAsString(legacy);

        // 키 자체가 빠지면 앱의 3상(undefined=구서버/null=근거없음/값) 구분이 무너진다(계약 §1).
        assertThat(json).contains("\"goalMinutes\":null");
        assertThat(json).contains("\"progressMinutes\":null");
    }
}

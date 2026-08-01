package com.oneorthree.phone.focus.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.focus.domain.FocusType;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagResponse;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagsResponse;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.user.domain.Occupation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = FocusController.class)
class FocusControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FocusService focusService;

    @Test
    @DisplayName("세션 커서 조회 → 200, content/hasNext/nextCursor")
    void getFocusSessionsReturns200() throws Exception {
        UUID nextCursor = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
        given(focusService.getFocusSessions(any(), any(), any(), any(), anyInt()))
                .willReturn(new FocusSessionSliceResponse(
                        List.of(new FocusSessionResponse(null,
                                Instant.parse("2026-06-10T01:00:00Z"),
                                Instant.parse("2026-06-10T02:00:00Z"), 0)),
                        20, true, nextCursor));

        mockMvc.perform(get("/api/v1/focus-session")
                        .param("from", "2026-06-01T00:00:00Z")
                        .param("to", "2026-06-30T23:59:59Z")
                        .param("size", "20")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].totalDistractionSeconds").value(0))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andExpect(jsonPath("$.nextCursor").value(nextCursor.toString()))
                .andDo(print());
    }

    @Test
    @DisplayName("필수 파라미터(size) 누락 → 400")
    void getFocusSessionsMissingSizeReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/focus-session")
                        .param("from", "2026-06-01T00:00:00Z")
                        .param("to", "2026-06-30T23:59:59Z")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("from 형식 오류 → 400")
    void getFocusSessionsBadInstantReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/focus-session")
                        .param("from", "not-an-instant")
                        .param("to", "2026-06-30T23:59:59Z")
                        .param("size", "20")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("기본 태그 조회(occupation 지정) → 200, occupation/tags[name,sortOrder], tagId 없음")
    void getDefaultTagsReturns200() throws Exception {
        given(focusService.getDefaultTags(any(), eq(Occupation.UNIVERSITY)))
                .willReturn(new OccupationDefaultTagsResponse(Occupation.UNIVERSITY, List.of(
                        new OccupationDefaultTagResponse("전공 공부", 0),
                        new OccupationDefaultTagResponse("과제", 1))));

        mockMvc.perform(get("/api/v1/tag/defaults")
                        .param("occupation", "UNIVERSITY")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.occupation").value("UNIVERSITY"))
                .andExpect(jsonPath("$.tags[0].name").value("전공 공부"))
                .andExpect(jsonPath("$.tags[0].sortOrder").value(0))
                .andExpect(jsonPath("$.tags[0].tagId").doesNotExist())
                .andExpect(jsonPath("$.tags[1].name").value("과제"))
                .andDo(print());
    }

    @Test
    @DisplayName("기본 태그 조회 — occupation enum 에 없는 값 → 400")
    void getDefaultTagsInvalidOccupationReturns400() throws Exception {
        mockMvc.perform(get("/api/v1/tag/defaults")
                        .param("occupation", "NOT_A_JOB")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // ── 세션완료 응답 필드 (GROMO-806, additive) ─────────────────────────────

    @Test
    @DisplayName("POST /focus-session → 201 + body(dayTotalFocusSeconds·streakQualifiedToday)")
    void saveFocusSessionReturns201WithBody() throws Exception {
        given(focusService.saveFocusSession(any(), any()))
                .willReturn(new FocusSessionSaveResponse(660, true, 0));

        String body = "{\"startedAt\":\"2026-06-23T01:00:00Z\",\"endedAt\":\"2026-06-23T01:11:00Z\","
                + "\"totalDistractionSeconds\":0}";
        mockMvc.perform(post("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.dayTotalFocusSeconds").value(660))
                .andExpect(jsonPath("$.streakQualifiedToday").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("PATCH /focus-session → 200 + body 에 dayTotalFocusSeconds·streakQualifiedToday 포함")
    void endFocusSessionReturns200WithStreakFields() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        given(focusService.endFocusSession(any(), any()))
                .willReturn(new FocusSessionEndResponse(sessionId,
                        Instant.parse("2026-06-23T01:00:00Z"),
                        Instant.parse("2026-06-23T01:05:00Z"),
                        300L, 0, 300, false));

        String body = "{\"sessionId\":\"" + sessionId + "\",\"endedAt\":\"2026-06-23T01:05:00Z\","
                + "\"totalDistractionSeconds\":0}";
        mockMvc.perform(patch("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dayTotalFocusSeconds").value(300))
                .andExpect(jsonPath("$.streakQualifiedToday").value(false))
                .andDo(print());
    }

    // ── focus_type 인입 + 취소 API (GROMO-733) ───────────────────────────────

    @Test
    @DisplayName("POST /focus-session/start — body 의 focusType 이 DTO 로 역직렬화되어 서비스로 전달, 201")
    void startFocusSessionDeserializesFocusType() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        given(focusService.startFocusSession(any(), any()))
                .willReturn(new FocusSessionStartResponse(sessionId, Instant.parse("2026-06-23T01:00:00Z")));

        String body = "{\"startedAt\":\"2026-06-23T01:00:00Z\",\"focusType\":\"POMODORO\"}";
        mockMvc.perform(post("/api/v1/focus-session/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated())
                .andDo(print());

        ArgumentCaptor<FocusSessionStartRequest> captor = ArgumentCaptor.forClass(FocusSessionStartRequest.class);
        verify(focusService).startFocusSession(any(), captor.capture());
        assertThat(captor.getValue().focusType()).isEqualTo(FocusType.POMODORO);
    }

    @Test
    @DisplayName("PATCH /focus-session/cancel — sessionId 로 취소 위임, 204")
    void cancelFocusSessionReturns204() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");

        String body = "{\"sessionId\":\"" + sessionId + "\"}";
        mockMvc.perform(patch("/api/v1/focus-session/cancel")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(focusService).cancelFocusSession(any(), any());
    }
}

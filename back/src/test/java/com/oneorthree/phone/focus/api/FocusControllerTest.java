package com.oneorthree.phone.focus.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.focus.domain.FocusType;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
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
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
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
    @DisplayName("POST /focus-session → 201 + body(dayTotalFocusSeconds·streakQualifiedToday·awardedCoins)")
    void saveFocusSessionReturns201WithBody() throws Exception {
        given(focusService.saveFocusSession(any(), any()))
                // awardedCoins=66(세션 지급, #417) + goalRewardCoins=0(목표 지급 없음)
                .willReturn(new FocusSessionSaveResponse(660, true, 66, 0, 166));

        String body = "{\"startedAt\":\"2026-06-23T01:00:00Z\",\"endedAt\":\"2026-06-23T01:11:00Z\","
                + "\"totalDistractionSeconds\":0}";
        mockMvc.perform(post("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.dayTotalFocusSeconds").value(660))
                .andExpect(jsonPath("$.streakQualifiedToday").value(true))
                // currency 폐쇄(서버 지급 전환): 지급 코인이 additive 필드로 실린다 — 구앱은 무시, 신앱은 잔액 반영
                .andExpect(jsonPath("$.awardedCoins").value(66))
                .andDo(print());
    }

    @Test
    @DisplayName("PATCH /focus-session → 200 + body 에 dayTotalFocusSeconds·streakQualifiedToday·지급 필드 포함")
    void endFocusSessionReturns200WithStreakFields() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        given(focusService.endFocusSession(any(), any()))
                .willReturn(new FocusSessionEndResponse(sessionId,
                        Instant.parse("2026-06-23T01:00:00Z"),
                        Instant.parse("2026-06-23T01:05:00Z"),
                        300L, 0, 300, false, 5, 30, 135));

        String body = "{\"sessionId\":\"" + sessionId + "\",\"endedAt\":\"2026-06-23T01:05:00Z\","
                + "\"totalDistractionSeconds\":0}";
        mockMvc.perform(patch("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dayTotalFocusSeconds").value(300))
                .andExpect(jsonPath("$.streakQualifiedToday").value(false))
                // GROMO-1214: 지급 필드는 POST 응답과 같은 이름·의미로 실린다(앱이 두 경로를 같은 코드로 소비)
                .andExpect(jsonPath("$.awardedCoins").value(5))
                .andExpect(jsonPath("$.goalRewardCoins").value(30))
                .andExpect(jsonPath("$.balanceAfter").value(135))
                .andDo(print());
    }

    // ── 날짜별 집중초 인입 (GROMO-1252 코드리뷰 2차 ①) ────────────────────────
    // JSON 오브젝트 키("YYYY-MM-DD")가 Map<LocalDate,Integer> 로 역직렬화되는지 — 이게 깨지면
    // 신버전 앱의 모든 업로드가 400 이 된다(트러스트 바운더리).

    @Test
    @DisplayName("POST /focus-session — focusSecondsByDate 가 Map<LocalDate,Integer> 로 역직렬화되어 서비스로 전달")
    void saveFocusSessionDeserializesFocusSecondsByDate() throws Exception {
        given(focusService.saveFocusSession(any(), any()))
                .willReturn(new FocusSessionSaveResponse(600, true, 10, 0, 10));

        String body = "{\"startedAt\":\"2026-07-12T14:50:00Z\",\"endedAt\":\"2026-07-12T15:15:00Z\","
                + "\"totalDistractionSeconds\":0,"
                + "\"focusSecondsByDate\":{\"2026-07-12\":300,\"2026-07-13\":300}}";
        mockMvc.perform(post("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated())
                .andDo(print());

        ArgumentCaptor<FocusSessionRequest> captor = ArgumentCaptor.forClass(FocusSessionRequest.class);
        verify(focusService).saveFocusSession(any(), captor.capture());
        assertThat(captor.getValue().getFocusSecondsByDate())
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        LocalDate.of(2026, 7, 12), 300, LocalDate.of(2026, 7, 13), 300));
    }

    @Test
    @DisplayName("PATCH /focus-session — focusSecondsByDate 역직렬화(미전송이면 null → 서버 벽시계 폴백)")
    void endFocusSessionDeserializesFocusSecondsByDate() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        given(focusService.endFocusSession(any(), any()))
                .willReturn(new FocusSessionEndResponse(sessionId,
                        Instant.parse("2026-07-12T14:50:00Z"),
                        Instant.parse("2026-07-12T15:15:00Z"),
                        1500L, 0, 300, false, 0, 0, 0));

        String body = "{\"sessionId\":\"" + sessionId + "\",\"endedAt\":\"2026-07-12T15:15:00Z\","
                + "\"totalDistractionSeconds\":0,\"focusSecondsByDate\":{\"2026-07-13\":300}}";
        mockMvc.perform(patch("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andDo(print());

        ArgumentCaptor<FocusSessionEndRequest> captor = ArgumentCaptor.forClass(FocusSessionEndRequest.class);
        verify(focusService).endFocusSession(any(), captor.capture());
        assertThat(captor.getValue().focusSecondsByDate())
                .containsExactlyInAnyOrderEntriesOf(Map.of(LocalDate.of(2026, 7, 13), 300));
    }

    // ── 1214-②: 방해 초 음수 차단(돈 경로) ───────────────────────────────────
    // 지급 공식이 (endedAt − startedAt) − totalDistractionSeconds 라, 음수를 보내면 집중초가 늘어나
    // 방금 발급한 몇 초짜리 마커로도 12시간 캡(720코인)까지 긁을 수 있었다. 같은 값이 방해 통계에도 그대로 저장된다.

    @Test
    @DisplayName("1214-②: PATCH /focus-session — totalDistractionSeconds 음수 → 400, 서비스 미호출")
    void endFocusSessionRejectsNegativeDistraction() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        String body = "{\"sessionId\":\"" + sessionId + "\",\"endedAt\":\"2026-06-23T01:05:00Z\","
                + "\"totalDistractionSeconds\":-43200}";

        mockMvc.perform(patch("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
        verify(focusService, never()).endFocusSession(any(), any());
    }

    @Test
    @DisplayName("1214-②: POST /focus-session — totalDistractionSeconds 음수 → 400, 서비스 미호출")
    void saveFocusSessionRejectsNegativeDistraction() throws Exception {
        String body = "{\"startedAt\":\"2026-06-23T01:00:00Z\",\"endedAt\":\"2026-06-23T01:11:00Z\","
                + "\"totalDistractionSeconds\":-43200}";

        mockMvc.perform(post("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
        verify(focusService, never()).saveFocusSession(any(), any());
    }

    // 엔트리 수 상한(GROMO-1252 코드리뷰 4차 ③) — 인증된 클라가 임의로 큰 맵을 보내면 서버가
    // 거의 다 버릴 값을 만들고 순회하느라 힙·CPU 를 먼저 태운다. 트러스트 바운더리에서 400 으로 자른다.

    private static String secondsByDateJson(int entries) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < entries; i++) {
            sb.append(i == 0 ? "" : ",").append("\"").append(LocalDate.of(2026, 1, 1).plusDays(i)).append("\":60");
        }
        return "{" + sb + "}";
    }

    @Test
    @DisplayName("POST /focus-session — focusSecondsByDate 엔트리 33개(상한 32 초과) → 400")
    void saveFocusSessionRejectsOversizedFocusSecondsByDate() throws Exception {
        String body = "{\"startedAt\":\"2026-07-12T14:50:00Z\",\"endedAt\":\"2026-07-12T15:15:00Z\","
                + "\"totalDistractionSeconds\":0,\"focusSecondsByDate\":" + secondsByDateJson(33) + "}";
        mockMvc.perform(post("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest());

        verify(focusService, never()).saveFocusSession(any(), any());
    }

    @Test
    @DisplayName("PATCH /focus-session — focusSecondsByDate 엔트리 33개(상한 32 초과) → 400")
    void endFocusSessionRejectsOversizedFocusSecondsByDate() throws Exception {
        UUID sessionId = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
        String body = "{\"sessionId\":\"" + sessionId + "\",\"endedAt\":\"2026-07-12T15:15:00Z\","
                + "\"totalDistractionSeconds\":0,\"focusSecondsByDate\":" + secondsByDateJson(33) + "}";
        mockMvc.perform(patch("/api/v1/focus-session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest());

        verify(focusService, never()).endFocusSession(any(), any());
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

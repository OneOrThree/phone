package com.oneorthree.phone.analytics.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.analytics.exception.AnalyticsErrorCode;
import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.analytics.service.AnalyticsService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = AnalyticsController.class)
class AnalyticsControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private AnalyticsService analyticsService;

    @Test
    @DisplayName("클라 이벤트 수신 성공 → 204, 서비스에 event·payload 전달")
    void recordEventReturns204() throws Exception {
        Map<String, Object> body = Map.of(
                "event", "focus_session_started",
                "payload", Map.of("has_tag", true, "goal_minutes", 60));

        mockMvc.perform(post("/api/v1/analytics/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(analyticsService).record(
                eq("focus_session_started"), eq(Map.of("has_tag", true, "goal_minutes", 60)));
    }

    @Test
    @DisplayName("payload 생략(이벤트만) → 204")
    void recordEventWithoutPayloadReturns204() throws Exception {
        mockMvc.perform(post("/api/v1/analytics/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("event", "focus_session_abandoned"))))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(analyticsService).record(eq("focus_session_abandoned"), any());
    }

    @Test
    @DisplayName("event 누락 → 400, 서비스 미호출")
    void recordEventMissingEventReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/analytics/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("payload", Map.of("k", 1)))))
                .andExpect(status().isBadRequest())
                .andDo(print());

        verify(analyticsService, never()).record(anyString(), any());
    }

    @Test
    @DisplayName("event 공백 → 400")
    void recordEventBlankEventReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/analytics/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("event", "  "))))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("화이트리스트 외 이벤트 → 400 + UNSUPPORTED_EVENT 에러 코드")
    void recordEventUnsupportedEventReturns400() throws Exception {
        willThrow(new AnalyticsException(AnalyticsErrorCode.UNSUPPORTED_EVENT))
                .given(analyticsService).record(eq("screen_view"), any());

        mockMvc.perform(post("/api/v1/analytics/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("event", "screen_view"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_EVENT"))
                .andDo(print());
    }

    @Test
    @DisplayName("payload 검증 실패 → 400 + INVALID_PAYLOAD 에러 코드")
    void recordEventInvalidPayloadReturns400() throws Exception {
        willThrow(new AnalyticsException(AnalyticsErrorCode.INVALID_PAYLOAD))
                .given(analyticsService).record(eq("focus_session_started"), any());

        mockMvc.perform(post("/api/v1/analytics/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "event", "focus_session_started",
                                "payload", Map.of("nested", Map.of("k", 1))))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAYLOAD"))
                .andDo(print());
    }
}

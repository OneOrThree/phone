package com.oneorthree.phone.screentime.api;

import com.oneorthree.phone.screentime.service.ScreenTimeService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = ScreenTimeController.class)
class ScreenTimeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ScreenTimeService screenTimeService;

    private static final String VALID = """
            {"screenTimeGoalAchieved": true, "actualScreenTimeMinutes": 120,
             "reportedAt": "2026-06-29T12:00:00Z", "timeZone": "Asia/Seoul"}
            """;

    @Test
    @DisplayName("스크린타임 저장 성공 → 204")
    void saveScreenTimeReturns204() throws Exception {
        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(VALID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(screenTimeService).saveScreenTime(any(), any());
    }

    @Test
    @DisplayName("actualScreenTimeMinutes 음수 → 400")
    void saveScreenTimeNegativeMinutesReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"screenTimeGoalAchieved": true, "actualScreenTimeMinutes": -1,
                                 "reportedAt": "2026-06-29T12:00:00Z", "timeZone": "Asia/Seoul"}
                                """))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("screenTimeGoalAchieved null → 400")
    void saveScreenTimeNullAchievedReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"screenTimeGoalAchieved": null, "actualScreenTimeMinutes": 120,
                                 "reportedAt": "2026-06-29T12:00:00Z", "timeZone": "Asia/Seoul"}
                                """))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("reportedAt null → 400")
    void saveScreenTimeNullReportedAtReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"screenTimeGoalAchieved": true, "actualScreenTimeMinutes": 120,
                                 "reportedAt": null, "timeZone": "Asia/Seoul"}
                                """))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("timeZone 누락(blank) → 400")
    void saveScreenTimeBlankTimeZoneReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"screenTimeGoalAchieved": true, "actualScreenTimeMinutes": 120,
                                 "reportedAt": "2026-06-29T12:00:00Z", "timeZone": ""}
                                """))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }
}

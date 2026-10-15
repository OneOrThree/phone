package com.oneorthree.phone.screentime.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.screentime.ScreenTimeController;
import com.oneorthree.phone.screentime.service.ScreenTimeService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
             "reportedAt": "2026-06-29T12:00:00Z"}
            """;

    @Test
    @DisplayName("스크린타임 저장 성공 → 204")
    void saveScreenTimeReturns204() throws Exception {
        UUID userId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(VALID)
                        .requestAttr(AuthAttributes.USER_ID, userId))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(screenTimeService).saveScreenTime(eq(userId), any());
    }

    @Test
    @DisplayName("actualScreenTimeMinutes 음수 → 400")
    void saveScreenTimeNegativeMinutesReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/screen-time")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"screenTimeGoalAchieved": true, "actualScreenTimeMinutes": -1,
                                 "reportedAt": "2026-06-29T12:00:00Z"}
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
                                 "reportedAt": "2026-06-29T12:00:00Z"}
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
                                 "reportedAt": null}
                                """))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }
}

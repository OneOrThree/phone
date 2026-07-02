package com.oneorthree.phone.user.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = UserController.class)
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private UserService userService;

    @Test
    @DisplayName("디바이스 토큰 등록 성공 → 204")
    void registerDeviceTokenReturns204() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("deviceToken", "apns-device-token"))))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).registerDeviceToken(any(), eq("apns-device-token"));
    }

    @Test
    @DisplayName("deviceToken 누락(blank) → 400")
    void registerDeviceTokenBlankReturns400() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Collections.singletonMap("deviceToken", ""))))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("deviceToken null → 400")
    void registerDeviceTokenNullReturns400() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceToken\": null}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("알림 설정 저장 성공 → 204")
    void updateNotificationSettingsReturns204() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("notificationEnabled", true);
        body.put("soundEnabled", false);
        body.put("nightModeEnabled", true);
        body.put("nightStartTime", "22:00");
        body.put("nightEndTime", "07:00");

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateNotificationSettings(any(), any());
    }

    @Test
    @DisplayName("알림 설정 - 필수 boolean 필드 누락 → 400")
    void updateNotificationSettingsMissingFieldReturns400() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("notificationEnabled", true);
        // soundEnabled, nightModeEnabled 누락

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("occupation 저장 성공 → 204")
    void updateOccupationReturns204() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/occupation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("occupation", "UNIVERSITY"))))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateOccupation(any(), eq(Occupation.UNIVERSITY));
    }

    @Test
    @DisplayName("occupation null → 400")
    void updateOccupationNullReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/occupation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"occupation\": null}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("occupation 정의되지 않은 값 → 400")
    void updateOccupationInvalidValueReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/occupation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"occupation\": \"DOCTOR\"}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 목표 수정 성공 → 204")
    void updateScreenTimeGoalReturns204() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/screen-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("dailyScreenTimeGoalMinutes", 120))))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateScreenTimeGoal(any(), eq(120));
    }

    @Test
    @DisplayName("스크린타임 목표 null → 400")
    void updateScreenTimeGoalNullReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/screen-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyScreenTimeGoalMinutes\": null}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("스크린타임 목표 음수 → 400")
    void updateScreenTimeGoalNegativeReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/screen-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Collections.singletonMap("dailyScreenTimeGoalMinutes", -1))))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("프로필 수정(PATCH /user) - 집중/스크린 목표 음수 → 400")
    void updateProfileNegativeGoalReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/user")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyFocusTimeGoalMinutes\": -1}"))
                .andExpect(status().isBadRequest())
                .andDo(print());

        mockMvc.perform(patch("/api/v1/user")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyScreenTimeGoalMinutes\": -5}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("프로필 등록(POST /user) - 집중 목표 음수 → 400")
    void setupProfileNegativeGoalReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/user")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyFocusTimeGoalMinutes\": -1}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("집중 목표 수정 성공 → 204")
    void updateFocusTimeGoalReturns204() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/focus-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("dailyFocusTimeGoalMinutes", 90))))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateFocusTimeGoal(any(), eq(90));
    }

    @Test
    @DisplayName("집중 목표 null → 400")
    void updateFocusTimeGoalNullReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/focus-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyFocusTimeGoalMinutes\": null}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("집중 목표 음수 → 400")
    void updateFocusTimeGoalNegativeReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/focus-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Collections.singletonMap("dailyFocusTimeGoalMinutes", -1))))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("알림 설정 - night 시각 포맷 오류 → 400")
    void updateNotificationSettingsInvalidTimeReturns400() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("notificationEnabled", true);
        body.put("soundEnabled", true);
        body.put("nightModeEnabled", true);
        body.put("nightStartTime", "abc");

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("알림 설정 - nightStartTime null 허용(@Pattern 은 null 통과) → 204")
    void updateNotificationSettingsNullNightTimeReturns204() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("notificationEnabled", true);
        body.put("soundEnabled", true);
        body.put("nightModeEnabled", false);
        body.put("nightStartTime", null);
        body.put("nightEndTime", null);

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateNotificationSettings(any(), any());
    }
}

package com.oneorthree.phone.user.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.StatVisibility;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;
import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = UserController.class)
class UserControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private UserService userService;

    @Test
    @DisplayName("닉네임 체크 GET → 200 {available:true}, 로그인 유저 기준 판정 (GROMO-1215)")
    void checkNicknameReturnsAvailableTrue() throws Exception {
        given(userService.isNicknameAvailable(LOGIN_USER_ID, "멋진닉")).willReturn(true);

        mockMvc.perform(get("/api/v1/users/nickname/check")
                        .param("nickname", "멋진닉")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("닉네임 체크 — 중복/형식 위반도 200 {available:false} (4xx 분기 없음)")
    void checkNicknameReturnsAvailableFalseWith200() throws Exception {
        given(userService.isNicknameAvailable(LOGIN_USER_ID, "가")).willReturn(false);

        mockMvc.perform(get("/api/v1/users/nickname/check")
                        .param("nickname", "가")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("닉네임 체크 — 파라미터 누락도 200 {available:false} (항상 200 계약)")
    void checkNicknameMissingParamStillReturns200() throws Exception {
        given(userService.isNicknameAvailable(eq(LOGIN_USER_ID), isNull())).willReturn(false);

        mockMvc.perform(get("/api/v1/users/nickname/check")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("디바이스 토큰 등록 성공 → 204")
    void registerDeviceTokenReturns204() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("deviceToken", "apns-device-token")))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).registerDeviceToken(any(), eq("apns-device-token"));
    }

    @Test
    @DisplayName("512자 토큰 PUT → 204 (검증 완화 확인)")
    void registerDeviceToken512CharsReturns204() throws Exception {
        String token = "a".repeat(512);

        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("deviceToken", token)))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).registerDeviceToken(any(), eq(token));
    }

    @Test
    @DisplayName("513자 토큰 PUT → 400 (@Size(max=512) 초과)")
    void registerDeviceToken513CharsReturns400() throws Exception {
        String token = "a".repeat(513);

        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("deviceToken", token))))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("디바이스 토큰 해제 DELETE → 204 + clearDeviceToken 호출")
    void clearDeviceTokenReturns204() throws Exception {
        mockMvc.perform(delete("/api/v1/users/me/device-token")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).clearDeviceToken(any());
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
                        .content(objectMapper.writeValueAsString(body))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
                        .content(objectMapper.writeValueAsString(Map.of("occupation", "UNIVERSITY")))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
                        .content(objectMapper.writeValueAsString(Map.of("dailyScreenTimeGoalMinutes", 120)))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
    @DisplayName("프로필 수정(PATCH /users/me) - 집중/스크린 목표 음수 → 400")
    void updateProfileNegativeGoalReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyFocusTimeGoalMinutes\": -1}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());

        mockMvc.perform(patch("/api/v1/users/me")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyScreenTimeGoalMinutes\": -5}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("프로필 등록(POST /users/me) - 집중 목표 음수 → 400")
    void setupProfileNegativeGoalReturns400() throws Exception {
        mockMvc.perform(post("/api/v1/users/me")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dailyFocusTimeGoalMinutes\": -1}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("집중 목표 수정 성공 → 204")
    void updateFocusTimeGoalReturns204() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/focus-time-goal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("dailyFocusTimeGoalMinutes", 90)))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
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
                        .content(objectMapper.writeValueAsString(body))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateNotificationSettings(any(), any());
    }

    // ── GET /users/me/notification-settings ───────────────────────────────

    @Test
    @DisplayName("알림 설정 조회 → 200 + 5개 필드 노출")
    void getNotificationSettingsReturns200() throws Exception {
        given(userService.getNotificationSettings(any())).willReturn(
                new NotificationSettingsResponse(true, false, true, "22:00", "07:00"));

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notificationEnabled").value(true))
                .andExpect(jsonPath("$.soundEnabled").value(false))
                .andExpect(jsonPath("$.nightModeEnabled").value(true))
                .andExpect(jsonPath("$.nightStartTime").value("22:00"))
                .andExpect(jsonPath("$.nightEndTime").value("07:00"))
                .andDo(print());

        verify(userService).getNotificationSettings(any());
    }

    @Test
    @DisplayName("알림 설정 조회 - 설정 없음 → 404")
    void getNotificationSettingsNotFoundReturns404() throws Exception {
        willThrow(new UserException(UserErrorCode.NOT_FOUND))
                .given(userService).getNotificationSettings(any());

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNotFound())
                .andDo(print());
    }

    // ── PATCH /users/me/stat-visibility ───────────────────────────────────

    @Test
    @DisplayName("통계 공개 범위 수정 성공 → 204")
    void updateStatVisibilityReturns204() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/stat-visibility")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("statVisibility", "PUBLIC")))
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).updateStatVisibility(any(), eq(StatVisibility.PUBLIC));
    }

    @Test
    @DisplayName("statVisibility null → 400")
    void updateStatVisibilityNullReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/stat-visibility")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"statVisibility\": null}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    @Test
    @DisplayName("statVisibility 정의되지 않은 값 → 400")
    void updateStatVisibilityInvalidValueReturns400() throws Exception {
        mockMvc.perform(patch("/api/v1/users/me/stat-visibility")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"statVisibility\": \"EVERYONE\"}"))
                .andExpect(status().isBadRequest())
                .andDo(print());
    }

    // ── GET /users/me/social-links ────────────────────────────────────────

    @Test
    @DisplayName("게스트/무연동 유저 → GET /users/me/social-links → 200 빈 배열")
    void getSocialLinksReturnsEmptyArrayForUnlinkedUser() throws Exception {
        given(userService.getSocialLinks(any())).willReturn(List.of());

        mockMvc.perform(get("/api/v1/users/me/social-links")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(0))
                .andDo(print());

        verify(userService).getSocialLinks(any());
    }

    @Test
    @DisplayName("소셜 연동 목록 조회 → 200 + JSON 배열")
    void getSocialLinksReturns200() throws Exception {
        given(userService.getSocialLinks(any())).willReturn(List.of(
                new SocialLinkResponse("APPLE", Instant.parse("2025-03-01T12:00:00Z")),
                new SocialLinkResponse("GOOGLE", Instant.parse("2025-04-10T09:30:00Z"))
        ));

        mockMvc.perform(get("/api/v1/users/me/social-links")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].provider").value("APPLE"))
                .andDo(print());

        verify(userService).getSocialLinks(any());
    }

    // ── DELETE /users/me/social-links/{provider} ──────────────────────────

    @Test
    @DisplayName("소셜 연동 해제 성공 → 204")
    void unlinkSocialAccountReturns204() throws Exception {
        mockMvc.perform(delete("/api/v1/users/me/social-links/APPLE")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(userService).unlinkSocialAccount(any(), eq(Provider.APPLE));
    }

    @Test
    @DisplayName("미연동 provider 해제 시도 → 404")
    void unlinkSocialAccountNotLinkedReturns404() throws Exception {
        willThrow(new UserException(UserErrorCode.SOCIAL_ACCOUNT_NOT_FOUND))
                .given(userService).unlinkSocialAccount(any(), eq(Provider.KAKAO));

        mockMvc.perform(delete("/api/v1/users/me/social-links/KAKAO")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNotFound())
                .andDo(print());
    }

    @Test
    @DisplayName("마지막 연동 해제 시도 → 409")
    void unlinkSocialAccountLastOneReturns409() throws Exception {
        willThrow(new UserException(UserErrorCode.LAST_SOCIAL_ACCOUNT))
                .given(userService).unlinkSocialAccount(any(), eq(Provider.GOOGLE));

        mockMvc.perform(delete("/api/v1/users/me/social-links/GOOGLE")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isConflict())
                .andDo(print());
    }
}

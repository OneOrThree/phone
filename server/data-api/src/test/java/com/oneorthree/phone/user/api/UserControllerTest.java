package com.oneorthree.phone.user.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.user.UserController;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;
import java.util.Collections;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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

    // ── GET /users/me/notification-settings ───────────────────────────────

    // ── PATCH /users/me/stat-visibility ───────────────────────────────────

    // ── GET /users/me/social-links ────────────────────────────────────────

    // ── DELETE /users/me/social-links/{provider} ──────────────────────────
}

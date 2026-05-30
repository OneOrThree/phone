package com.oneorthree.phone.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.exception.InvalidKakaoTokenException;
import com.oneorthree.phone.exception.InvalidRefreshTokenException;
import com.oneorthree.phone.service.AuthService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private AuthService authService;

    @Test
    @DisplayName("카카오 로그인 성공 - 신규 유저")
    void kakaoLoginNewUserReturns200() throws Exception {
        given(authService.kakaoLogin("valid-kakao-token"))
                .willReturn(new KakaoLoginResponse("at", "rt", true));

        mockMvc.perform(post("/api/v1/auth/kakao")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                    Map.of("kakaoAccessToken", "valid-kakao-token")
                )))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("at"))
                .andExpect(jsonPath("$.refreshToken").value("rt"))
                .andExpect(jsonPath("$.isNewUser").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("카카오 로그인 성공 - 기존 유저")
    void kakaoLoginExistingUserReturns200() throws Exception {
        given(authService.kakaoLogin("valid-kakao-token"))
                .willReturn(new KakaoLoginResponse("at", "rt", false));

        mockMvc.perform(post("/api/v1/auth/kakao")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                    Map.of("kakaoAccessToken", "valid-kakao-token")
                )))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isNewUser").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("유효하지 않은 카카오 토큰 → 401")
    void kakaoLoginInvalidTokenReturns401() throws Exception {
        given(authService.kakaoLogin("bad-token"))
                .willThrow(new InvalidKakaoTokenException());

        mockMvc.perform(post("/api/v1/auth/kakao")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                    Map.of("kakaoAccessToken", "bad-token")
                )))
                .andExpect(status().isUnauthorized())
                .andDo(print());
    }

    @Test
    @DisplayName("토큰 갱신 성공 → 새 Access Token 반환")
    void refreshTokenSuccessReturns200() throws Exception {
        given(authService.refreshToken("valid-rt"))
                .willReturn(new TokenRefreshResponse("new-at"));

        mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                    Map.of("refreshToken", "valid-rt")
                )))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("new-at"))
                .andDo(print());
    }

    @Test
    @DisplayName("유효하지 않은 RT → 401")
    void refreshTokenInvalidReturns401() throws Exception {
        given(authService.refreshToken("bad-rt"))
                .willThrow(new InvalidRefreshTokenException());

        mockMvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                    Map.of("refreshToken", "bad-rt")
                )))
                .andExpect(status().isUnauthorized())
                .andDo(print());
    }
}

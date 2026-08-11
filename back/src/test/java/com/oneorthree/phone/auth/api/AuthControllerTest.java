package com.oneorthree.phone.auth.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.service.GuestLoginRateLimiter;
import com.oneorthree.phone.common.util.ClientIpResolver;
import com.oneorthree.phone.user.domain.Provider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = AuthController.class)
// 게스트 레이트리밋은 실제 빈으로 태워야 429 매핑까지 검증된다 (GROMO-1510). 한도는 테스트용으로 2회.
@Import({ClientIpResolver.class, GuestLoginRateLimiter.class})
@TestPropertySource(properties = "auth.guest.rate-limit.max-per-window=2")
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private AuthService authService;

    @Test
    @DisplayName("카카오 로그인 성공 - 신규 유저")
    void kakaoLoginNewUserReturns200() throws Exception {
        given(authService.socialLogin(eq(Provider.KAKAO), eq("valid-kakao-token"), isNull()))
                .willReturn(new SocialLoginResponse("at", "rt", true));

        mockMvc.perform(post("/api/v1/auth/kakao")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("token", "valid-kakao-token"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isNewUser").value(true))
                .andExpect(jsonPath("$.accessToken").value("at"))
                .andDo(print());
    }

    @Test
    @DisplayName("카카오 로그인 성공 - 기존 유저")
    void kakaoLoginExistingUserReturns200() throws Exception {
        given(authService.socialLogin(eq(Provider.KAKAO), eq("valid-kakao-token"), isNull()))
                .willReturn(new SocialLoginResponse("at", "rt", false));

        mockMvc.perform(post("/api/v1/auth/kakao")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("token", "valid-kakao-token"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isNewUser").value(false))
                .andDo(print());
    }

    @Test
    @DisplayName("구글 로그인 성공 - SocialLoginRequest(token) 라우팅")
    void googleLoginReturns200() throws Exception {
        given(authService.socialLogin(eq(Provider.GOOGLE), eq("valid-google-token"), isNull()))
                .willReturn(new SocialLoginResponse("at", "rt", true));

        mockMvc.perform(post("/api/v1/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("token", "valid-google-token"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isNewUser").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("페이스북 로그인 성공 - SocialLoginRequest(token) 라우팅")
    void facebookLoginReturns200() throws Exception {
        given(authService.socialLogin(eq(Provider.FACEBOOK), eq("valid-facebook-token"), isNull()))
                .willReturn(new SocialLoginResponse("at", "rt", true));

        mockMvc.perform(post("/api/v1/auth/facebook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("token", "valid-facebook-token"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isNewUser").value(true))
                .andExpect(jsonPath("$.accessToken").value("at"))
                .andDo(print());
    }

    @Test
    @DisplayName("애플 로그인 성공 - identityToken 검증 (fullName 은 서버 미사용, 온보딩에서 닉네임 입력)")
    void appleLoginReturns200() throws Exception {
        given(authService.socialLogin(eq(Provider.APPLE), eq("valid-apple-token"), isNull()))
                .willReturn(new SocialLoginResponse("at", "rt", true));

        mockMvc.perform(post("/api/v1/auth/apple")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("identityToken", "valid-apple-token", "fullName", "홍길동"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isNewUser").value(true))
                .andDo(print());
    }

    @Test
    @DisplayName("유효하지 않은 소셜 토큰 → 401")
    void socialLoginInvalidTokenReturns401() throws Exception {
        given(authService.socialLogin(eq(Provider.KAKAO), eq("bad-token"), isNull()))
                .willThrow(new InvalidTokenException(InvalidTokenErrorCode.KAKAO_TOKEN));

        mockMvc.perform(post("/api/v1/auth/kakao")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("token", "bad-token"))))
                .andExpect(status().isUnauthorized())
                .andDo(print());
    }

    @Test
    @DisplayName("토큰 갱신 성공 → 새 AT 반환")
    void refreshTokenSuccessReturns200() throws Exception {
        given(authService.refreshToken("valid-rt"))
                .willReturn(new TokenRefreshResponse("new-at"));

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("refreshToken", "valid-rt"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("new-at"))
                .andDo(print());
    }

    @Test
    @DisplayName("게스트 로그인 - 한도 안에서는 200")
    void guestLoginWithinLimitReturns200() throws Exception {
        given(authService.guestLogin()).willReturn(new GuestLoginResponse("at", "rt", true));

        mockMvc.perform(post("/api/v1/auth/guest").header("X-Forwarded-For", "203.0.113.10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("at"))
                .andDo(print());
    }

    @Test
    @DisplayName("게스트 로그인 - 같은 IP 가 한도를 넘기면 429")
    void guestLoginOverLimitReturns429() throws Exception {
        given(authService.guestLogin()).willReturn(new GuestLoginResponse("at", "rt", true));

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/auth/guest").header("X-Forwarded-For", "203.0.113.20"))
                    .andExpect(status().isOk());
        }

        mockMvc.perform(post("/api/v1/auth/guest").header("X-Forwarded-For", "203.0.113.20"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("GUEST_CREATION_RATE_LIMITED"))
                .andDo(print());
    }

    @Test
    @DisplayName("유효하지 않은 RT → 401")
    void refreshTokenInvalidReturns401() throws Exception {
        given(authService.refreshToken("bad-rt"))
                .willThrow(new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN));

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("refreshToken", "bad-rt"))))
                .andExpect(status().isUnauthorized())
                .andDo(print());
    }
}

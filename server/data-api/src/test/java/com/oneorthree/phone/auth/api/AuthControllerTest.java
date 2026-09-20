package com.oneorthree.phone.auth.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.auth.AuthController;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.GuestLoginRateLimiter;
import com.oneorthree.phone.common.util.ClientIpResolver;
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
    @DisplayName("토큰 갱신 성공 → 새 AT 반환")
    void refreshTokenSuccessReturns200() throws Exception {
        given(authService.refreshToken("valid-rt"))
                .willReturn(new TokenRefreshResponse("new-at", null));

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

        mockMvc.perform(post("/api/v1/auth/guest").header("X-Real-IP", "203.0.113.10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("at"))
                .andDo(print());
    }

    @Test
    @DisplayName("게스트 로그인 - 같은 IP 가 한도를 넘기면 429")
    void guestLoginOverLimitReturns429() throws Exception {
        given(authService.guestLogin()).willReturn(new GuestLoginResponse("at", "rt", true));

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/auth/guest").header("X-Real-IP", "203.0.113.20"))
                    .andExpect(status().isOk());
        }

        mockMvc.perform(post("/api/v1/auth/guest").header("X-Real-IP", "203.0.113.20"))
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

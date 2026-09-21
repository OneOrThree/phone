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
import java.util.UUID;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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

    /**
     * 1.x 로그인 경로는 <b>그대로다</b> — 자격은 여전히 본문에 실리고 헤더는 붙지 않는다
     * (GROMO-2037 · 계정 LLD §2.1 「기존 legacy 로그인의 body 전달 방식은 보존한다」).
     *
     * <p>2.0 표면이 그 값을 {@code X-Device-Bootstrap} 헤더로 옮겼다고 해서 이쪽을 같이 옮기면,
     * 헤더를 모르는 1.x 앱이 자격을 «받지 못한 채» 통과한다 — 기기 등록은 성공하므로 아무 오류도
     * 나지 않고, 그 기기만 조용히 세션 확인 없는 경로로 남는다. 스토어의 1.1.0 이 그 앱이다.
     */
    @Test
    @DisplayName("1.x 게스트 로그인은 자격을 본문으로 주고 X-Device-Bootstrap 헤더를 붙이지 않는다")
    void legacyGuestLoginKeepsTheCredentialInTheBody() throws Exception {
        given(authService.guestLogin())
                .willReturn(new GuestLoginResponse("at", "rt", true, "legacy-bootstrap", UUID.randomUUID()));

        mockMvc.perform(post("/api/v1/auth/guest").header("X-Real-IP", "203.0.113.30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deviceBootstrap").value("legacy-bootstrap"))
                .andExpect(header().doesNotExist("X-Device-Bootstrap"));
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

package com.oneorthree.phone.common.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserActivityService;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class JwtFilterTest {

    private final JwtProvider jwtProvider = Mockito.mock(JwtProvider.class);
    private final UserActivityService userActivityService = Mockito.mock(UserActivityService.class);
    private final UserRepository userRepository = Mockito.mock(UserRepository.class);
    private final JwtFilter jwtFilter = new JwtFilter(jwtProvider, userActivityService, userRepository);

    @ParameterizedTest
    @DisplayName("화이트리스트 소셜 로그인 경로는 토큰 없이도 컨트롤러까지 도달한다")
    @ValueSource(strings = {
            "/api/v1/auth/google",
            "/api/v1/auth/line",
            "/api/v1/auth/instagram",
            "/api/v1/auth/kakao",
            "/api/v1/auth/apple",
            "/api/v1/auth/guest",
            "/api/v1/auth/refresh"
    })
    void whitelistedPathPassesWithoutToken(String uri) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(chain.getRequest()).isNotNull();
        Mockito.verifyNoInteractions(jwtProvider);
        // 소프트딜리트 차단 조회(GROMO-827)도 공개 경로에는 개입하지 않는다
        Mockito.verifyNoInteractions(userRepository);
    }

    @Test
    @DisplayName("화이트리스트가 아닌 경로는 토큰이 없으면 401로 차단한다")
    void nonWhitelistedPathWithoutTokenReturns401() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = Mockito.spy(new MockFilterChain());

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    @DisplayName("화이트리스트가 아닌 경로는 유효한 토큰 + 활성 유저면 userId 세팅 후 통과하고 last_active_at 을 갱신한다")
    void nonWhitelistedPathWithValidTokenPasses() throws Exception {
        UUID userId = UUID.randomUUID();
        given(jwtProvider.isTokenValid("valid-token")).willReturn(true);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        // 활성 유저(is_deleted=false) — 소프트딜리트 차단 존재 조회에서 true 반환
        given(userRepository.existsByIdAndIsDeletedFalse(userId)).willReturn(true);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(request.getAttribute("userId")).isEqualTo(userId);
        // 인증 통과 지점에서 last_active_at 스로틀 갱신 호출 (GROMO-578)
        verify(userActivityService).touchLastActive(eq(userId), any(Instant.class));
    }

    @Test
    @DisplayName("소프트딜리트(탈퇴) 유저의 유효한 토큰은 401로 차단하고 컨트롤러에 닿지 않는다 (GROMO-827)")
    void softDeletedUserWithValidTokenReturns401() throws Exception {
        UUID userId = UUID.randomUUID();
        given(jwtProvider.isTokenValid("valid-token")).willReturn(true);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        // 탈퇴 유저(is_deleted=true) — 활성 유저 존재 조회에서 false 반환
        given(userRepository.existsByIdAndIsDeletedFalse(userId)).willReturn(false);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = Mockito.spy(new MockFilterChain());

        jwtFilter.doFilter(request, response, chain);

        // 토큰 미제공/무효와 동일한 401 신호로 통일
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        assertThat(response.getContentAsString()).isEqualTo("{\"error\":\"UNAUTHORIZED\"}");
        verify(chain, never()).doFilter(request, response);
        // 차단 시 userId 세팅·활동 갱신 모두 일어나지 않는다
        assertThat(request.getAttribute("userId")).isNull();
        Mockito.verifyNoInteractions(userActivityService);
    }

    @Test
    @DisplayName("last_active_at 갱신이 실패해도 요청은 그대로 컨트롤러까지 통과한다")
    void requestProceedsEvenIfLastActiveUpdateThrows() throws Exception {
        UUID userId = UUID.randomUUID();
        given(jwtProvider.isTokenValid("valid-token")).willReturn(true);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        given(userRepository.existsByIdAndIsDeletedFalse(userId)).willReturn(true);
        Mockito.doThrow(new RuntimeException("DB down"))
                .when(userActivityService).touchLastActive(eq(userId), any(Instant.class));

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(chain.getRequest()).isNotNull();
    }
}

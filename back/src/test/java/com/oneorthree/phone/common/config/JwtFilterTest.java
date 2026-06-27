package com.oneorthree.phone.common.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class JwtFilterTest {

    private final JwtProvider jwtProvider = Mockito.mock(JwtProvider.class);
    private final JwtFilter jwtFilter = new JwtFilter(jwtProvider);

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
    @DisplayName("화이트리스트가 아닌 경로는 유효한 토큰이면 userId 세팅 후 통과한다")
    void nonWhitelistedPathWithValidTokenPasses() throws Exception {
        java.util.UUID userId = java.util.UUID.randomUUID();
        given(jwtProvider.isTokenValid("valid-token")).willReturn(true);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(request.getAttribute("userId")).isEqualTo(userId);
    }
}

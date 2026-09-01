package com.oneorthree.phone.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.config.JwtFilter;
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
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class JwtFilterTest {

    // 갱신이 필요한(stale) last_active_at — 슬라이딩 창 판정 자체는 UserActivityServiceTest 가 검증한다.
    private static final Instant YESTERDAY = Instant.now().minus(1, ChronoUnit.DAYS);

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
        given(jwtProvider.extractType("valid-token")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        // 활성 유저(is_deleted=false) — 탈퇴 차단 조회가 last_active_at 을 반환(GROMO-903)
        given(userRepository.findLastActiveAtIfActive(userId)).willReturn(Optional.of(YESTERDAY));
        given(userActivityService.needsTouch(any(), any(Instant.class))).willReturn(true);

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
        given(jwtProvider.extractType("valid-token")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        // 탈퇴 유저(is_deleted=true) — 조회가 empty (없는 유저와 동일 신호, GROMO-903)
        given(userRepository.findLastActiveAtIfActive(userId)).willReturn(Optional.empty());

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
        given(jwtProvider.extractType("valid-token")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        given(userRepository.findLastActiveAtIfActive(userId)).willReturn(Optional.of(YESTERDAY));
        given(userActivityService.needsTouch(any(), any(Instant.class))).willReturn(true);
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

    @Test
    @DisplayName("오늘 이미 갱신된 유저는 UPDATE 경로에 진입조차 하지 않는다 (GROMO-903 회귀 가드)")
    void alreadyTouchedTodaySkipsUpdate() throws Exception {
        UUID userId = UUID.randomUUID();
        given(jwtProvider.isTokenValid("valid-token")).willReturn(true);
        given(jwtProvider.extractType("valid-token")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        given(userRepository.findLastActiveAtIfActive(userId)).willReturn(Optional.of(Instant.now()));
        // 오늘 이미 갱신됨 → 갱신 불필요 판정
        given(userActivityService.needsTouch(any(), any(Instant.class))).willReturn(false);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(request.getAttribute("userId")).isEqualTo(userId);
        // 이 티켓의 핵심: 트랜잭션 UPDATE 왕복이 아예 없다(이전엔 0건 매치 UPDATE 가 매 요청 나갔다)
        verify(userActivityService, never()).touchLastActive(any(), any(Instant.class));
    }

    @Test
    @DisplayName("조회로 읽은 last_active_at 이 그대로 판정에 쓰이고, stale 이면 갱신한다 (GROMO-903)")
    void staleLastActiveTriggersUpdate() throws Exception {
        UUID userId = UUID.randomUUID();
        given(jwtProvider.isTokenValid("valid-token")).willReturn(true);
        given(jwtProvider.extractType("valid-token")).willReturn(JwtProvider.TYPE_ACCESS);
        given(jwtProvider.extractUserId("valid-token")).willReturn(userId);
        given(userRepository.findLastActiveAtIfActive(userId)).willReturn(Optional.of(YESTERDAY));
        given(userActivityService.needsTouch(any(), any(Instant.class))).willReturn(true);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        // 추가 조회 없이 조회 결과가 곧바로 판정 입력이 된다 — 왕복이 늘지 않는 근거
        verify(userActivityService).needsTouch(eq(YESTERDAY), any(Instant.class));
        verify(userActivityService).touchLastActive(eq(userId), any(Instant.class));
    }

    @Test
    @DisplayName("refresh 토큰으로 /api/* 직접 인증 시도는 401로 차단한다 (GROMO-714)")
    void refreshTokenCannotAuthenticateApiPath() throws Exception {
        given(jwtProvider.isTokenValid("refresh-token")).willReturn(true);
        given(jwtProvider.extractType("refresh-token")).willReturn(JwtProvider.TYPE_REFRESH);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer refresh-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = Mockito.spy(new MockFilterChain());

        jwtFilter.doFilter(request, response, chain);

        // 30일 RT 가 1시간 access 만료 정책을 우회하던 경로 차단 — 컨트롤러에 닿지 않는다
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(request, response);
        // 타입 가드에서 끝나므로 유저 조회·활동 갱신까지 가지 않는다
        Mockito.verifyNoInteractions(userRepository);
        Mockito.verifyNoInteractions(userActivityService);
    }

    @Test
    @DisplayName("type 클레임이 없는 구 토큰은 401로 차단한다 (fail-closed, GROMO-714)")
    void legacyTokenWithoutTypeClaimReturns401() throws Exception {
        given(jwtProvider.isTokenValid("legacy-token")).willReturn(true);
        // 714 이전에 발급된 토큰은 type 클레임이 없어 extractType 이 null 을 반환한다
        given(jwtProvider.extractType("legacy-token")).willReturn(null);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/users/me");
        request.addHeader("Authorization", "Bearer legacy-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = Mockito.spy(new MockFilterChain());

        jwtFilter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(request, response);
    }
}

package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.domain.Provider;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 로그인·갱신·로그아웃 배선으로 기기별 세션 독립성과 미회전 계약을 검증한다. */
@SpringBootTest
class MultiSessionRefreshIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    AuthService authService;
    @Autowired
    SessionLogoutService sessionLogoutService;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    JdbcTemplate jdbc;
    @Value("${jwt.secret}")
    String jwtSecret;

    @Test
    void refreshOnFirstDeviceSurvivesSecondDeviceLogin() {
        String providerId = UUID.randomUUID().toString();
        SocialLoginResponse first = login(providerId);
        SocialLoginResponse second = login(providerId);

        TokenRefreshResponse refreshed = authService.refreshSessionAccessToken(first.refreshToken());

        assertThat(refreshed.accessToken()).isNotBlank();
        assertThat(refreshed.sessionId()).isEqualTo(first.sessionId());
        assertThat(refreshed.refreshToken()).isNull();
        assertThat(authService.refreshSessionAccessToken(second.refreshToken()).sessionId())
                .isEqualTo(second.sessionId());
    }

    @Test
    void refreshNearExpiryKeepsOriginalCredentialUsable() {
        SocialLoginResponse login = login(UUID.randomUUID().toString());
        UUID userId = authSessionRepository.findById(login.sessionId()).orElseThrow().getUserId();
        JwtProvider shortLived = new JwtProvider(jwtSecret, 3600L, 600L, 600L);
        String refreshToken = shortLived.generateRefreshToken(userId, false);
        jdbc.update("UPDATE auth_sessions SET refresh_token_hash = ? WHERE id = ?",
                TokenHasher.sha256Hex(refreshToken), login.sessionId());

        assertThat(authService.refreshSessionAccessToken(refreshToken).refreshToken()).isNull();
        assertThat(authService.refreshSessionAccessToken(refreshToken).sessionId()).isEqualTo(login.sessionId());
        assertThat(authSessionRepository.findById(login.sessionId()).orElseThrow().getRefreshTokenHash())
                .isEqualTo(TokenHasher.sha256Hex(refreshToken));
    }

    @Test
    void logoutRevokesOnlyThatSessionAndReplaysSafely() {
        String providerId = UUID.randomUUID().toString();
        SocialLoginResponse first = login(providerId);
        SocialLoginResponse second = login(providerId);

        assertThat(sessionLogoutService.logout(first.refreshToken(), first.accessToken())).isEqualTo(first.sessionId());
        assertThat(sessionLogoutService.logout(first.refreshToken(), first.accessToken())).isEqualTo(first.sessionId());

        assertThatThrownBy(() -> authService.refreshSessionAccessToken(first.refreshToken()))
                .isInstanceOf(InvalidTokenException.class);
        assertThat(authService.refreshSessionAccessToken(second.refreshToken()).sessionId())
                .isEqualTo(second.sessionId());
    }

    @Test
    void signedRefreshWithoutSessionIsRejected() {
        SocialLoginResponse login = login(UUID.randomUUID().toString());
        UUID userId = authSessionRepository.findById(login.sessionId()).orElseThrow().getUserId();
        String orphan = new JwtProvider(jwtSecret, 3600L, 600L, 600L).generateRefreshToken(userId, false);

        assertThatThrownBy(() -> authService.refreshSessionAccessToken(orphan))
                .isInstanceOf(InvalidTokenException.class);
        assertThatThrownBy(() -> sessionLogoutService.logout(orphan, null))
                .isInstanceOf(InvalidTokenException.class);
    }

    private SocialLoginResponse login(String providerId) {
        return authService.loginOrRegister(Provider.KAKAO, providerId, null, null, null, null);
    }
}

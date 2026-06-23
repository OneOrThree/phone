package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.service.JwtProvider;
import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtProviderTest {

    private JwtProvider jwtProvider;

    @BeforeEach
    void setUp() {
        jwtProvider = new JwtProvider(
            "test-secret-key-that-is-at-least-256-bits-long-padded-for-sha256",
            3600L,
            2592000L
        );
    }

    @Test
    @DisplayName("Access Token 발급 후 userId 추출 성공")
    void generateAndExtractAccessToken() {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000042");
        String token = jwtProvider.generateAccessToken(id);
        UUID userId = jwtProvider.extractUserId(token);
        assertThat(userId).isEqualTo(id);
    }

    @Test
    @DisplayName("Refresh Token 발급 후 userId 추출 성공")
    void generateAndExtractRefreshToken() {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000007");
        String token = jwtProvider.generateRefreshToken(id);
        UUID userId = jwtProvider.extractUserId(token);
        assertThat(userId).isEqualTo(id);
    }

    @Test
    @DisplayName("유효하지 않은 토큰 검증 시 JwtException 발생")
    void invalidTokenThrowsJwtException() {
        assertThatThrownBy(() -> jwtProvider.extractUserId("invalid.token.value"))
                .isInstanceOf(JwtException.class);
    }

    @Test
    @DisplayName("isTokenValid: 유효한 토큰 → true")
    void validTokenReturnsTrue() {
        String token = jwtProvider.generateAccessToken(UUID.fromString("00000000-0000-0000-0000-000000000001"));
        assertThat(jwtProvider.isTokenValid(token)).isTrue();
    }

    @Test
    @DisplayName("isTokenValid: 잘못된 토큰 → false")
    void invalidTokenReturnsFalse() {
        assertThat(jwtProvider.isTokenValid("bad.token")).isFalse();
    }
}

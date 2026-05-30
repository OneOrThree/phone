package com.oneorthree.phone.service;

import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

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
        String token = jwtProvider.generateAccessToken(42L);
        Long userId = jwtProvider.extractUserId(token);
        assertThat(userId).isEqualTo(42L);
    }

    @Test
    @DisplayName("Refresh Token 발급 후 userId 추출 성공")
    void generateAndExtractRefreshToken() {
        String token = jwtProvider.generateRefreshToken(7L);
        Long userId = jwtProvider.extractUserId(token);
        assertThat(userId).isEqualTo(7L);
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
        String token = jwtProvider.generateAccessToken(1L);
        assertThat(jwtProvider.isTokenValid(token)).isTrue();
    }

    @Test
    @DisplayName("isTokenValid: 잘못된 토큰 → false")
    void invalidTokenReturnsFalse() {
        assertThat(jwtProvider.isTokenValid("bad.token")).isFalse();
    }
}

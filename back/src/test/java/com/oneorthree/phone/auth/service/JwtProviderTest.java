package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.service.JwtProvider;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtProviderTest {

    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-padded-for-sha256";

    private JwtProvider jwtProvider;

    @BeforeEach
    void setUp() {
        jwtProvider = new JwtProvider(SECRET, 3600L, 2592000L);
    }

    @Test
    @DisplayName("Access Token 발급 후 userId 추출 성공")
    void generateAndExtractAccessToken() {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000042");
        String token = jwtProvider.generateAccessToken(id, false);
        UUID userId = jwtProvider.extractUserId(token);
        assertThat(userId).isEqualTo(id);
    }

    @Test
    @DisplayName("Refresh Token 발급 후 userId 추출 성공")
    void generateAndExtractRefreshToken() {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000007");
        String token = jwtProvider.generateRefreshToken(id, false);
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
        String token = jwtProvider.generateAccessToken(UUID.fromString("00000000-0000-0000-0000-000000000001"), false);
        assertThat(jwtProvider.isTokenValid(token)).isTrue();
    }

    @Test
    @DisplayName("isTokenValid: 잘못된 토큰 → false")
    void invalidTokenReturnsFalse() {
        assertThat(jwtProvider.isTokenValid("bad.token")).isFalse();
    }

    @Test
    @DisplayName("Access Token 은 type=access 클레임을 갖는다")
    void accessTokenHasAccessTypeClaim() {
        String token = jwtProvider.generateAccessToken(UUID.randomUUID(), false);
        assertThat(jwtProvider.extractType(token)).isEqualTo(JwtProvider.TYPE_ACCESS);
    }

    @Test
    @DisplayName("Refresh Token 은 type=refresh 클레임을 갖는다")
    void refreshTokenHasRefreshTypeClaim() {
        String token = jwtProvider.generateRefreshToken(UUID.randomUUID(), false);
        assertThat(jwtProvider.extractType(token)).isEqualTo(JwtProvider.TYPE_REFRESH);
    }

    @Test
    @DisplayName("type 클레임 추가 후에도 userId 추출은 그대로 동작한다")
    void typeClaimDoesNotBreakUserIdExtraction() {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000099");
        assertThat(jwtProvider.extractUserId(jwtProvider.generateAccessToken(id, false))).isEqualTo(id);
        assertThat(jwtProvider.extractUserId(jwtProvider.generateRefreshToken(id, false))).isEqualTo(id);
    }

    @Test
    @DisplayName("guest 클레임 왕복 — 발급 시점 값이 그대로 추출된다 (GROMO-1229)")
    void guestClaimRoundTrip() {
        UUID id = UUID.randomUUID();
        assertThat(jwtProvider.extractIsGuest(jwtProvider.generateAccessToken(id, true))).isTrue();
        assertThat(jwtProvider.extractIsGuest(jwtProvider.generateAccessToken(id, false))).isFalse();
        assertThat(jwtProvider.extractIsGuest(jwtProvider.generateRefreshToken(id, true))).isTrue();
        assertThat(jwtProvider.extractIsGuest(jwtProvider.generateRefreshToken(id, false))).isFalse();
    }

    @Test
    @DisplayName("guest 클레임 없는 구 토큰 → null (비게스트 간주는 호출부 책임 — GROMO-1229 점진 적용)")
    void legacyTokenWithoutGuestClaimReturnsNull() {
        // 1229 이전 발급 토큰 재현 — 같은 서명키로 guest 클레임 없이 직접 빌드한다
        String legacyToken = Jwts.builder()
                .subject(UUID.randomUUID().toString())
                .claim("type", JwtProvider.TYPE_ACCESS)
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .compact();

        assertThat(jwtProvider.extractIsGuest(legacyToken)).isNull();
    }

    @Test
    @DisplayName("secret이 blank이면 생성 시 IllegalStateException 발생")
    void blankSecretThrowsIllegalStateException() {
        assertThatThrownBy(() -> new JwtProvider("   ", 3600L, 2592000L))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("secret이 null이면 생성 시 IllegalStateException 발생")
    void nullSecretThrowsIllegalStateException() {
        assertThatThrownBy(() -> new JwtProvider(null, 3600L, 2592000L))
                .isInstanceOf(IllegalStateException.class);
    }
}

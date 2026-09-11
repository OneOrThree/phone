package com.oneorthree.chat.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 토큰 검증의 계약 — 특히 <b>{@code type} 가드</b>.
 *
 * <p>access 와 refresh 는 같은 키로 서명되므로 서명 검증만으로는 구분되지 않는다. 이 가드가 빠지면
 * 수명 30일짜리 refresh 토큰으로 채팅에 붙을 수 있게 되어 access 1시간 만료 정책이 무력화된다 —
 * 그런데 «붙어진다»는 건 정상 동작으로 보이기 때문에 테스트가 없으면 회귀가 조용하다.
 */
class JwtValidatorTest {

    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256";

    private final SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
    private final JwtValidator validator = new JwtValidator(SECRET);

    @Test
    @DisplayName("서명·만료·type 이 모두 맞으면 userId 가 나온다")
    void acceptsValidAccessToken() {
        UUID userId = UUID.randomUUID();

        assertThat(validator.extractUserId(token(userId, "access", 3600, key))).contains(userId);
    }

    @Test
    @DisplayName("refresh 토큰은 서명이 맞아도 거절한다")
    void rejectsRefreshToken() {
        assertThat(validator.extractUserId(token(UUID.randomUUID(), "refresh", 3600, key))).isEmpty();
    }

    @Test
    @DisplayName("type 클레임이 아예 없는 구 토큰도 거절한다(fail-closed)")
    void rejectsTokenWithoutTypeClaim() {
        String noType = Jwts.builder()
                .subject(UUID.randomUUID().toString())
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(key)
                .compact();

        assertThat(validator.extractUserId(noType)).isEmpty();
    }

    @Test
    @DisplayName("만료된 토큰은 거절한다")
    void rejectsExpiredToken() {
        assertThat(validator.extractUserId(token(UUID.randomUUID(), "access", -60, key))).isEmpty();
    }

    @Test
    @DisplayName("다른 키로 서명한 토큰은 거절한다")
    void rejectsForeignSignature() {
        SecretKey otherKey = Keys.hmacShaKeyFor(
                "another-secret-key-that-is-also-long-enough-for-hmac-sha256!!".getBytes(StandardCharsets.UTF_8));

        assertThat(validator.extractUserId(token(UUID.randomUUID(), "access", 3600, otherKey))).isEmpty();
    }

    @Test
    @DisplayName("subject 가 UUID 가 아니면 거절한다 — 예외를 밖으로 흘리지 않는다")
    void rejectsNonUuidSubject() {
        String weird = Jwts.builder()
                .subject("not-a-uuid")
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(key)
                .compact();

        assertThat(validator.extractUserId(weird)).isEmpty();
    }

    @Test
    @DisplayName("null·빈 문자열도 조용히 empty 다")
    void handlesMissingToken() {
        assertThat(validator.extractUserId(null)).isEmpty();
        assertThat(validator.extractUserId("  ")).isEmpty();
    }

    @Test
    @DisplayName("서명키가 비어 있으면 «부팅»이 실패한다 — 검증 없는 서버가 뜨는 것보다 낫다")
    void refusesToStartWithoutSecret() {
        assertThatThrownBy(() -> new JwtValidator("  ")).isInstanceOf(IllegalStateException.class);
    }

    private static String token(UUID userId, String type, long ttlSeconds, SecretKey signingKey) {
        return Jwts.builder()
                .subject(userId.toString())
                .claim("type", type)
                .expiration(Date.from(Instant.now().plusSeconds(ttlSeconds)))
                .signWith(signingKey)
                .compact();
    }
}

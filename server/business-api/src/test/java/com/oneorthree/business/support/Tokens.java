package com.oneorthree.business.support;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * 테스트용 토큰 발급기 — <b>실제 서명</b>으로 만든다.
 *
 * <p>검증을 스텁으로 갈아 끼우면 이 서비스의 보안 경계가 검증 대상에서 통째로 빠진다.
 * 그래서 {@code ci} 프로파일의 {@code jwt.secret} 과 같은 키로 진짜 JWT 를 만든다.
 */
public final class Tokens {

    /** {@code application-ci.yml} 의 값과 같아야 한다. */
    public static final String CI_SECRET =
            "ci-test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256";

    private Tokens() {
    }

    public static String access(UUID userId) {
        return build(userId, "access", false, null, 3600);
    }

    /** {@code gen} claim 을 실은 AT — 세대가 봉투에 실려 나가는지 보기 위한 것. */
    public static String accessWithGeneration(UUID userId, long generation) {
        return build(userId, "access", false, generation, 3600);
    }

    /** refresh 토큰 — 서명이 맞아도 거절돼야 한다(type 가드). */
    public static String refresh(UUID userId) {
        return build(userId, "refresh", false, null, 3600);
    }

    /** 만료된 AT. */
    public static String expired(UUID userId) {
        return build(userId, "access", false, null, -60);
    }

    /** 다른 키로 서명한 AT — 서명 검증에서 떨어져야 한다. */
    public static String signedWithOtherKey(UUID userId) {
        SecretKey other = Keys.hmacShaKeyFor(
                "another-secret-key-that-is-also-at-least-256-bits-long-for-hmac".getBytes(StandardCharsets.UTF_8));
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .issuedAt(new Date(now))
                .expiration(new Date(now + 3_600_000L))
                .signWith(other)
                .compact();
    }

    /** {@code type} claim 이 아예 없는 구 토큰 — fail-closed 로 거절돼야 한다. */
    public static String withoutTypeClaim(UUID userId) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(userId.toString())
                .issuedAt(new Date(now))
                .expiration(new Date(now + 3_600_000L))
                .signWith(key())
                .compact();
    }

    private static String build(UUID userId, String type, boolean guest, Long generation, long ttlSeconds) {
        long now = System.currentTimeMillis();
        var builder = Jwts.builder()
                .subject(userId.toString())
                .claim("type", type)
                .claim("guest", guest)
                .issuedAt(new Date(now))
                .expiration(new Date(now + ttlSeconds * 1000L));
        if (generation != null) {
            builder.claim("gen", generation);
        }
        return builder.signWith(key()).compact();
    }

    private static SecretKey key() {
        return Keys.hmacShaKeyFor(CI_SECRET.getBytes(StandardCharsets.UTF_8));
    }
}

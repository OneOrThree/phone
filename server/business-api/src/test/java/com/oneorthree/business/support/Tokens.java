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
        return build(userId, "access", false, null, null, 3600);
    }

    /** {@code gen} claim 을 실은 AT — 세대가 봉투에 실려 나가는지 보기 위한 것. */
    public static String accessWithGeneration(UUID userId, long generation) {
        return build(userId, "access", false, generation, null, 3600);
    }

    /**
     * {@code gen} · {@code sid} 를 모두 실은 AT — <b>지금 AuthService 가 발급하는 모양</b>이다.
     *
     * <p>구 앱도 이 토큰을 쓴다(토큰은 서버가 만들고 본문은 앱이 만든다). 그래서 「sid 가 있다」는
     * 「앱이 자격을 저장한다」가 아니라 「이 요청의 세션을 서버가 안다」는 뜻이다.
     */
    public static String accessWithSession(UUID userId, long generation, UUID sessionId) {
        return build(userId, "access", false, generation, sessionId, 3600);
    }

    /** refresh 토큰 — 서명이 맞아도 거절돼야 한다(type 가드). */
    public static String refresh(UUID userId) {
        return build(userId, "refresh", false, null, null, 3600);
    }

    /** 세션과 세대를 가진 신규 RT. */
    public static String refreshWithSession(UUID userId, long generation, UUID sessionId) {
        return build(userId, "refresh", false, generation, sessionId, 3600);
    }

    /** 만료된 AT. */
    public static String expired(UUID userId) {
        return build(userId, "access", false, null, null, -60);
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

    /**
     * {@code exp} 가 «아예 없는» AT — 거절돼야 한다.
     *
     * <p>exp 는 JWT 스펙상 선택 필드라 파서가 「만료되지 않았다」로 통과시킨다. 막지 않으면 서명만
     * 맞으면 영구히 유효한 AT 가 되어 AT 1시간 만료 정책이 통째로 무력화된다.
     */
    public static String withoutExpiration(UUID userId) {
        return Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .issuedAt(new Date(System.currentTimeMillis()))
                .signWith(key())
                .compact();
    }

    /**
     * {@code sub} 가 없는 AT — 401 이어야 한다(500 이 아니라).
     *
     * <p>{@code UUID.fromString(null)} 은 IllegalArgumentException 이 아니라 NPE 다. 검증기가 subject
     * 존재를 먼저 보지 않으면 그 NPE 가 필터 밖으로 새어 500 이 된다.
     */
    public static String withoutSubject() {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .claim("type", "access")
                .issuedAt(new Date(now))
                .expiration(new Date(now + 3_600_000L))
                .signWith(key())
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

    private static String build(UUID userId, String type, boolean guest, Long generation, UUID sessionId,
            long ttlSeconds) {
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
        if (sessionId != null) {
            builder.claim("sid", sessionId.toString());
        }
        return builder.signWith(key()).compact();
    }

    private static SecretKey key() {
        return Keys.hmacShaKeyFor(CI_SECRET.getBytes(StandardCharsets.UTF_8));
    }
}

package com.oneorthree.phone.auth.service;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

@Component
public class JwtProvider {

    public static final String TYPE_ACCESS = "access";
    public static final String TYPE_REFRESH = "refresh";

    private static final String CLAIM_TYPE = "type";
    private static final String CLAIM_GUEST = "guest";

    private final SecretKey secretKey;
    private final long accessExpiration;
    private final long refreshExpiration;
    private final long guestRefreshExpiration;

    public JwtProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-expiration}") long accessExpiration,
            @Value("${jwt.refresh-expiration}") long refreshExpiration,
            @Value("${jwt.guest-refresh-expiration}") long guestRefreshExpiration
    ) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("jwt.secret 미설정");
        }

        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessExpiration = accessExpiration;
        this.refreshExpiration = refreshExpiration;
        this.guestRefreshExpiration = guestRefreshExpiration;
    }

    // isGuest 는 **발급 시점**의 유저 상태다 (GROMO-1229) — 게스트 로그인 경로만 true 를 싣고,
    // 소셜 로그인·승격 직후·리프레시 재발급은 그 시점 유저 상태(비게스트면 false)를 싣는다.
    public String generateAccessToken(UUID userId, boolean isGuest) {
        return buildToken(userId, accessExpiration, TYPE_ACCESS, isGuest);
    }

    /**
     * refresh 토큰 발급 — 게스트만 수명을 길게 잡는다 (GROMO-1509).
     *
     * <p>소셜 계정은 만료돼도 재로그인으로 <b>같은 계정</b>에 돌아오지만, 게스트는 돌아갈 곳이 없다
     * ({@code guestLogin} 은 언제나 새 User 를 만든다). 게스트에게 만료는 곧 계정 소실이라
     * 미접속 허용 기간을 따로 둔다.
     */
    public String generateRefreshToken(UUID userId, boolean isGuest) {
        return buildToken(userId, refreshTtlSeconds(isGuest), TYPE_REFRESH, isGuest);
    }

    /** 토큰 만료 시각. 서명·만료가 무효면 JwtException 이 전파된다(extractType 과 같은 규율). */
    public Date extractExpiration(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getExpiration();
    }

    /**
     * refresh 토큰을 지금 갈아끼워야 하는지 — 남은 수명이 발급 수명의 <b>절반 미만</b>이면 true.
     *
     * <p>매 갱신마다 회전시키지 않는다. 회전 1회는 "서버는 새 해시를 커밋했는데 응답이 유실돼
     * 클라이언트가 무효해진 옛 토큰을 든 채 남는" 창을 연다 — 그 창에 걸리면 강제 로그아웃이고,
     * 게스트에겐 그게 계정 소실이다. access 가 1시간이라 매 갱신마다 회전하면 한 달에 700번 넘게
     * 그 창이 열리는데, 절반 기준이면 수명당 1~2회로 줄어든다.
     *
     * <p>기준 수명은 <b>현재</b> 유저 상태로 정한다 — 게스트가 승격하면 다음 회전 때 소셜 수명의
     * 토큰으로 자연히 갈아탄다.
     */
    public boolean isRefreshRotationDue(Date expiration, boolean isGuest) {
        long remainingSeconds = (expiration.getTime() - System.currentTimeMillis()) / 1000;
        return remainingSeconds < refreshTtlSeconds(isGuest) / 2;
    }

    private long refreshTtlSeconds(boolean isGuest) {
        return isGuest ? guestRefreshExpiration : refreshExpiration;
    }

    /**
     * 토큰의 type 클레임을 반환한다 (GROMO-714).
     *
     * <p>클레임이 없는 구 토큰은 {@code null} 을 반환한다 — 호출부(JwtFilter·AuthService)가 이를 거부하는
     * fail-closed 전제이므로 여기서 기본값을 채우지 않는다. 서명·만료가 무효면 JwtException 이 전파되므로
     * 호출부는 isTokenValid 통과 후에 호출한다.
     */
    public String extractType(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get(CLAIM_TYPE, String.class);
    }

    /**
     * 토큰의 guest 클레임(발급 시점 게스트 여부)을 반환한다 (GROMO-1229).
     *
     * <p>클레임이 없는 구 토큰은 {@code null} 을 반환한다 — type 클레임의 "구 토큰 null" 처리와 동형이되,
     * 호출부(AuthService)는 null 을 <b>비게스트로 간주</b>해 현행 동작을 유지한다(점진 적용, D3).
     * 서명·만료가 무효면 JwtException 이 전파되므로 호출부는 isTokenValid 통과 후에 호출한다.
     */
    public Boolean extractIsGuest(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get(CLAIM_GUEST, Boolean.class);
    }

    public UUID extractUserId(String token) {

        String subject = Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getSubject();

        return UUID.fromString(subject);
    }

    public boolean isTokenValid(String token) {
        try {
            Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    private String buildToken(UUID userId, long expirationSeconds, String type, boolean isGuest) {
        Date now = new Date();
        return Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_TYPE, type)
                .claim(CLAIM_GUEST, isGuest)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expirationSeconds * 1000))
                .signWith(secretKey)
                .compact();
    }
}

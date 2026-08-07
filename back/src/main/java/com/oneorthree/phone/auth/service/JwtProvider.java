package com.oneorthree.phone.auth.service;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
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

    public JwtProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-expiration}") long accessExpiration,
            @Value("${jwt.refresh-expiration}") long refreshExpiration
    ) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("jwt.secret 미설정");
        }

        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessExpiration = accessExpiration;
        this.refreshExpiration = refreshExpiration;
    }

    // isGuest 는 **발급 시점**의 유저 상태다 (GROMO-1229) — 게스트 로그인 경로만 true 를 싣고,
    // 소셜 로그인·승격 직후·리프레시 재발급은 그 시점 유저 상태(비게스트면 false)를 싣는다.
    public String generateAccessToken(UUID userId, boolean isGuest) {
        return buildToken(userId, accessExpiration, TYPE_ACCESS, isGuest);
    }

    public String generateRefreshToken(UUID userId, boolean isGuest) {
        return buildToken(userId, refreshExpiration, TYPE_REFRESH, isGuest);
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

    /**
     * 토큰 발급 시각(iat) — 승격 패자 판별의 시간 게이팅에 쓴다 (GROMO-1229, claude 리뷰).
     * "이 토큰이 발급된 뒤에 생긴 소셜 연동"만 동시 승격 레이스의 산물일 수 있다.
     * iat 이 없는 비정상 토큰은 null — 호출부는 게이팅을 건너뛴다(가드 미적용 = 종전 동작).
     */
    public Instant extractIssuedAt(String token) {
        Date issuedAt = Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getIssuedAt();
        return issuedAt == null ? null : issuedAt.toInstant();
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

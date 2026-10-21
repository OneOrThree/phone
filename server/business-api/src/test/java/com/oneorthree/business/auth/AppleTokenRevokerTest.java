package com.oneorthree.business.auth;

import com.oneorthree.business.support.AppleKeys;
import com.oneorthree.business.support.MockUpstream;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 탈퇴 시 Apple 토큰 폐기(GROMO-2401) — client_secret JWT 와 token→revoke 호출 순서·본문. */
class AppleTokenRevokerTest {

    private static final MockUpstream APPLE = MockUpstream.start();
    private static final KeyPair KEY = AppleKeys.generate();
    private static final String PEM = AppleKeys.pem(KEY);
    private static final UUID USER = UUID.randomUUID();

    @BeforeEach
    void reset() {
        APPLE.reset();
    }

    @Test
    void clientSecretIsEs256JwtWithAppleClaims() throws Exception {
        // 파서가 만료를 검사하므로 «지금» 기준이어야 한다.
        Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);

        String secret = AppleTokenRevoker.clientSecret("com.example.app", "TEAM123456", "KEY1234567", PEM, now);

        Jws<Claims> jws = Jwts.parser().verifyWith(KEY.getPublic()).build().parseSignedClaims(secret);
        assertThat(jws.getHeader().getKeyId()).isEqualTo("KEY1234567");
        assertThat(jws.getHeader().getAlgorithm()).isEqualTo("ES256");
        Claims claims = jws.getPayload();
        assertThat(claims.getIssuer()).isEqualTo("TEAM123456");
        assertThat(claims.getSubject()).isEqualTo("com.example.app");
        assertThat(claims.getAudience()).containsExactly("https://appleid.apple.com");
        assertThat(claims.getIssuedAt().toInstant()).isEqualTo(now);
        assertThat(claims.getExpiration().toInstant()).isEqualTo(now.plusSeconds(300));
    }

    @Test
    void acceptsPemWithEscapedNewlines() throws Exception {
        String escaped = PEM.trim().replace("\n", "\\n");

        String secret = AppleTokenRevoker.clientSecret("c", "t", "k", escaped, Instant.now());

        assertThat(Jwts.parser().verifyWith(KEY.getPublic()).build().parseSignedClaims(secret)).isNotNull();
    }

    @Test
    void exchangesCodeThenRevokesRefreshToken() {
        APPLE.on("POST /auth/token", r -> new MockUpstream.Response(200,
                "{\"access_token\":\"AT\",\"refresh_token\":\"RT\"}"));
        APPLE.on("POST /auth/revoke", r -> new MockUpstream.Response(200, ""));

        revoker(PEM).revoke(USER, "the-code");

        var exchange = APPLE.receivedFor("POST /auth/token").get(0);
        assertThat(exchange.header("Content-Type")).startsWith("application/x-www-form-urlencoded");
        assertThat(exchange.body()).contains("client_id=com.example.app", "code=the-code",
                "grant_type=authorization_code", "client_secret=");
        var revoke = APPLE.receivedFor("POST /auth/revoke").get(0);
        assertThat(revoke.body()).contains("client_id=com.example.app", "token=RT",
                "token_type_hint=refresh_token", "client_secret=");
    }

    @Test
    void revokesAccessTokenWhenNoRefreshToken() {
        APPLE.on("POST /auth/token", r -> new MockUpstream.Response(200, "{\"access_token\":\"AT\"}"));
        APPLE.on("POST /auth/revoke", r -> new MockUpstream.Response(200, ""));

        revoker(PEM).revoke(USER, "the-code");

        assertThat(APPLE.receivedFor("POST /auth/revoke").get(0).body())
                .contains("token=AT", "token_type_hint=access_token");
    }

    @Test
    void tokenExchangeFailureSkipsRevokeWithoutThrowing() {
        APPLE.on("POST /auth/token", r -> new MockUpstream.Response(400, "{\"error\":\"invalid_grant\"}"));

        revoker(PEM).revoke(USER, "bad-code");

        assertThat(APPLE.receivedFor("POST /auth/revoke")).isEmpty();
    }

    @Test
    void revokeFailureOrBrokenKeyNeverThrows() {
        APPLE.on("POST /auth/token", r -> new MockUpstream.Response(200, "{\"refresh_token\":\"RT\"}"));
        APPLE.on("POST /auth/revoke", r -> new MockUpstream.Response(500, "{}"));
        revoker(PEM).revoke(USER, "c");
        assertThat(APPLE.hits("POST /auth/revoke")).isEqualTo(1);

        revoker("not-a-key").revoke(USER, "c");
        assertThat(APPLE.hits("POST /auth/token")).isEqualTo(1);
    }

    @Test
    void emptyConfigDisablesRevoke() {
        new AppleTokenRevoker("com.example.app", "", "", "", APPLE.baseUrl()).revoke(USER, "c");

        assertThat(APPLE.received()).isEmpty();
    }

    private static AppleTokenRevoker revoker(String pem) {
        return new AppleTokenRevoker("com.example.app", "TEAM123456", "KEY1234567", pem, APPLE.baseUrl());
    }
}

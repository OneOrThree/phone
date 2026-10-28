package com.oneorthree.realtime.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 신규 현재 인가 증명만 엄격하게 검증하고 기존 sid 없는 토큰 추출 계약은 유지한다. */
class VerifiedAccessIdentityTest {
    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256";
    private final SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
    private final JwtValidator validator = new JwtValidator(SECRET);
    private final UUID user = UUID.randomUUID();
    private final UUID session = UUID.randomUUID();
    private final Instant expiry = Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);

    @Test
    void verifiesCompleteIdentityWithoutInventingMissingClaims() {
        var result = validator.extractSessionProof(token(claims(), key)).orElseThrow();
        assertThat(result.userId()).isEqualTo(user);
        assertThat(result.sessionId()).isEqualTo(session);
        assertThat(result.authGeneration()).isZero();
        assertThat(result.expiresAt()).isEqualTo(expiry);
    }

    @ParameterizedTest
    @ValueSource(strings = {"sub", "sid", "gen", "exp", "type"})
    void rejectsEveryMissingRequiredClaim(String field) {
        var values = claims();
        values.remove(field);
        assertThat(validator.extractSessionProof(token(values, key))).isEmpty();
    }

    @Test
    void rejectsWrongSignatureRefreshExpiredAndMalformedTokens() {
        var values = claims();
        values.put("type", "refresh");
        assertThat(validator.extractSessionProof(token(values, key))).isEmpty();
        values = claims();
        values.put("exp", Date.from(Instant.now().minusSeconds(5)));
        assertThat(validator.extractSessionProof(token(values, key))).isEmpty();
        SecretKey foreign = Keys.hmacShaKeyFor(
                "another-secret-key-that-is-also-long-enough-for-hmac-sha256!!".getBytes(StandardCharsets.UTF_8));
        assertThat(validator.extractSessionProof(token(claims(), foreign))).isEmpty();
        assertThat(validator.extractSessionProof(null)).isEmpty();
        assertThat(validator.extractSessionProof(" ")).isEmpty();
        assertThat(validator.extractSessionProof("bad.token.parts")).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"sub", "sid"})
    void requiresFullUuidForBothSubjectAndSession(String field) {
        for (String value : new String[]{"1-1-1-1-1", "bad-uuid", " " + user}) {
            var values = claims();
            values.put(field, value);
            assertThat(validator.extractSessionProof(token(values, key))).isEmpty();
        }
    }

    @Test
    void generationRequiresNonnegativeSafeInteger() {
        for (Object generation : new Object[]{-1L, 0.0d, 0.5d, "0", 9007199254740992L}) {
            var values = claims();
            values.put("gen", generation);
            assertThat(validator.extractSessionProof(token(values, key))).isEmpty();
        }
        var values = claims();
        values.put("gen", 9007199254740991L);
        assertThat(validator.extractSessionProof(token(values, key)).orElseThrow().authGeneration())
                .isEqualTo(9007199254740991L);
    }

    @Test
    void legacySubjectExtractionStillAcceptsSidlessAccessToken() {
        var values = claims();
        values.remove("sid");
        values.remove("gen");
        String legacy = token(values, key);
        assertThat(validator.extractUserId(legacy)).contains(user);
        assertThat(validator.extractSessionProof(legacy)).isEmpty();
    }

    private Map<String, Object> claims() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sub", user.toString());
        result.put("sid", session.toString());
        result.put("gen", 0L);
        result.put("exp", Date.from(expiry));
        result.put("type", "access");
        return result;
    }

    private static String token(Map<String, Object> claims, SecretKey key) {
        return Jwts.builder().claims(claims).signWith(key).compact();
    }
}

package com.oneorthree.business.auth;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class JwtValidator {

    private final SecretKey key;

    public JwtValidator(@Value("${jwt.secret}") String secret) {
        key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public Optional<String> validate(String authorization) {
        if (authorization == null || authorization.length() > 8192 || !authorization.startsWith("Bearer ")) {
            return Optional.empty();
        }
        try {
            var claims = Jwts.parser().verifyWith(key).build()
                    .parseSignedClaims(authorization.substring(7)).getPayload();
            if (!"access".equals(claims.get("type", String.class)) || claims.getExpiration() == null
                    || claims.getSubject() == null) {
                return Optional.empty();
            }
            return Optional.of(UUID.fromString(claims.getSubject()).toString());
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}

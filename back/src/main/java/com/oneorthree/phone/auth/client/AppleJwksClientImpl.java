package com.oneorthree.phone.auth.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;
import java.util.List;
import java.util.Map;

@Component
public class AppleJwksClientImpl implements AppleJwksClient {

    private final RestClient restClient;

    public AppleJwksClientImpl(@Value("${apple.jwks-url}") String jwksUrl) {
        this.restClient = RestClient.builder()
                .baseUrl(jwksUrl)
                .build();
    }

    @Override
    public String extractSubject(String identityToken) {
        // Step 1 — identityToken 헤더에서 kid 추출
        String kid;
        try {
            String header = identityToken.split("\\.")[0];
            byte[] decodedHeader = Base64.getUrlDecoder().decode(header);
            String headerJson = new String(decodedHeader, StandardCharsets.UTF_8);
            Map<String, String> headerMap = new ObjectMapper().readValue(headerJson, Map.class);
            kid = headerMap.get("kid");
        } catch (Exception e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.APPLE_TOKEN);
        }

        // Step 2 — JWKS 호출해서 kid 일치하는 키 찾기
        Map<String, Object> jwks = restClient.get().uri("").retrieve().body(Map.class);
        List<Map<String, String>> keys = (List<Map<String, String>>) jwks.get("keys");
        Map<String, String> matchedKey = keys.stream()
                .filter(k -> kid.equals(k.get("kid")))
                .findFirst()
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.APPLE_TOKEN));

        // Step 3 — n, e 값으로 RSAPublicKey 생성
        PublicKey publicKey;
        try {
            BigInteger modulus = new BigInteger(1, Base64.getUrlDecoder().decode(matchedKey.get("n")));
            BigInteger exponent = new BigInteger(1, Base64.getUrlDecoder().decode(matchedKey.get("e")));
            publicKey = KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent));
        } catch (Exception e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.APPLE_TOKEN);
        }

        // Step 4 — 서명 검증 후 sub 반환
        try {
            return Jwts.parser()
                    .verifyWith(publicKey)
                    .build()
                    .parseSignedClaims(identityToken)
                    .getPayload()
                    .getSubject();
        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.APPLE_TOKEN);
        }
    }
}

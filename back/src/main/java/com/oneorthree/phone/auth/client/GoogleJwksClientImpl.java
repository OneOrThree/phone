package com.oneorthree.phone.auth.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.user.domain.Provider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import io.jsonwebtoken.Claims;
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
public class GoogleJwksClientImpl implements SocialLoginClient {

    private static final String ISS = "https://accounts.google.com";

    private final RestClient restClient;
    private final String clientId;

    public GoogleJwksClientImpl(
            @Value("${google.jwks-url}") String jwksUrl,
            @Value("${google.client-id}") String clientId) {
        this.restClient = RestClient.builder()
                .baseUrl(jwksUrl)
                .build();
        this.clientId = clientId;
    }

    @Override
    public Provider provider() {
        return Provider.GOOGLE;
    }

    @Override
    public String getProviderId(String token) {
        // Step 1 — id_token 헤더에서 kid 추출
        String kid;
        try {
            String header = token.split("\\.")[0];
            byte[] decodedHeader = Base64.getUrlDecoder().decode(header);
            String headerJson = new String(decodedHeader, StandardCharsets.UTF_8);
            Map<String, String> headerMap = new ObjectMapper().readValue(headerJson, Map.class);
            kid = headerMap.get("kid");
        } catch (Exception e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }

        // Step 2 — JWKS 호출해서 kid 일치하는 키 찾기
        Map<String, Object> jwks = restClient.get().uri("").retrieve().body(Map.class);
        List<Map<String, String>> keys = (List<Map<String, String>>) jwks.get("keys");
        Map<String, String> matchedKey = keys.stream()
                .filter(k -> kid.equals(k.get("kid")))
                .findFirst()
                .orElseThrow(() -> new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN));

        // Step 3 — n, e 값으로 RSAPublicKey 생성
        PublicKey publicKey;
        try {
            BigInteger modulus = new BigInteger(1, Base64.getUrlDecoder().decode(matchedKey.get("n")));
            BigInteger exponent = new BigInteger(1, Base64.getUrlDecoder().decode(matchedKey.get("e")));
            publicKey = KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent));
        } catch (Exception e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }

        // Step 4 — 서명 검증 후 Claims 파싱
        Claims claims;
        try {
            claims = Jwts.parser()
                    .verifyWith(publicKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (JwtException e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }

        // Step 5 — aud(우리 client-id)·iss 검증
        //   서명만 검증하면 다른 앱용으로 발급된 정상 토큰도 통과하므로 OIDC 표준대로 aud/iss를 확인한다.
        if (claims.getAudience() == null
                || !claims.getAudience().contains(clientId)
                || !ISS.equals(claims.getIssuer())) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }

        // Step 6 — sub 반환
        return claims.getSubject();
    }
}

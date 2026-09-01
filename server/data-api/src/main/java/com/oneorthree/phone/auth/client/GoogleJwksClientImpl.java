package com.oneorthree.phone.auth.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.user.repository.domain.Provider;
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

/**
 * Google OIDC id_token 을 <b>로컬에서</b> 검증한다 — 제공자 API 를 매 로그인마다 호출하는 대신
 * JWKS 공개키로 서명을 직접 확인하는 방식이다. 외부 호출은 JWKS 조회 1회뿐이다.
 *
 * <p>검증은 6단계다: 헤더에서 {@code kid} 추출 → JWKS 에서 같은 {@code kid} 의 키 탐색 →
 * {@code n}·{@code e} 로 RSA 공개키 복원 → 서명·만료 검증 → {@code aud}·{@code iss} 확인 →
 * {@code sub} 반환. 어느 단계에서 실패하든 원인을 구분하지 않고 같은
 * {@link InvalidTokenErrorCode#GOOGLE_TOKEN} 로 통일한다 — 공격자에게 어느 검증에서 걸렸는지 알려 주지 않기 위해서다.
 *
 * <p><b>5단계가 보안상 결정적이다.</b> 서명만 보면 Google 이 <b>다른 앱</b>에 발급한 정상 토큰도
 * 우리 키로 통과한다. {@code aud} 가 우리 구글 OAuth 클라이언트 id 이고 {@code iss} 가
 * {@code https://accounts.google.com} 인지까지 봐야 그 토큰으로 남의 계정에 로그인하는 경로가 막힌다.
 *
 * <p>JWKS 응답은 캐시하지 않는다 — Google 이 키를 회전해도 다음 로그인부터 바로 새 키를 집는다.
 */
@Component
public class GoogleJwksClientImpl implements SocialLoginClient {

    private static final String ISS = "https://accounts.google.com";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final RestClient restClient;
    private final String clientId;

    /**
     * @param jwksUrl {@code google.jwks-url} — Google 공개키 목록 엔드포인트. 매 검증마다 조회하므로
     *                여기가 막히면 Google 로그인 전체가 멎는다
     * @param clientId {@code google.client-id} — {@code aud} 클레임과 대조할 우리 구글 OAuth 클라이언트 id.
     *                 값이 틀리면 정상 토큰이 전부 거부되고, 검증을 건너뛰면 남의 앱 토큰이 통과한다
     */
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
            Map<String, String> headerMap = OBJECT_MAPPER.readValue(headerJson, Map.class);
            kid = headerMap.get("kid");
        } catch (Exception e) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }
        if (kid == null) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }

        // Step 2 — JWKS 호출해서 kid 일치하는 키 찾기
        Map<String, Object> jwks = restClient.get().uri("").retrieve().body(Map.class);
        if (jwks == null || jwks.get("keys") == null) {
            throw new InvalidTokenException(InvalidTokenErrorCode.GOOGLE_TOKEN);
        }
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

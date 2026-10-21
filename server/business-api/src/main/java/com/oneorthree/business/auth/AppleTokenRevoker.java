package com.oneorthree.business.auth;

import io.jsonwebtoken.Jwts;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 탈퇴 시 Sign in with Apple 토큰 폐기(GROMO-2401 · App Store 5.1.1(v)).
 *
 * <p>앱이 탈퇴 직전 Apple 로그인을 다시 돌려 받은 일회용 {@code authorizationCode} 를 Apple 에 교환해
 * refresh token 을 받고 곧바로 폐기한다. 아무것도 저장하지 않는다.
 *
 * <p>best-effort 다 — 탈퇴는 이미 Data 에 커밋됐으므로 설정 누락·Apple 오류·타임아웃은 WARN 한 줄만 남기고
 * 정상 반환한다. code·토큰·client_secret·개인키는 로그에 남기지 않는다.
 */
@Slf4j
@Component
public class AppleTokenRevoker {

    private static final String AUDIENCE = "https://appleid.apple.com";

    private final String clientId;
    private final String teamId;
    private final String keyId;
    private final String privateKey;
    private final String baseUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final ObjectMapper mapper = new ObjectMapper();

    public AppleTokenRevoker(@Value("${apple.revoke.client-id:}") String clientId,
                             @Value("${apple.revoke.team-id:}") String teamId,
                             @Value("${apple.revoke.key-id:}") String keyId,
                             @Value("${apple.revoke.private-key:}") String privateKey,
                             @Value("${apple.revoke.base-url:https://appleid.apple.com}") String baseUrl) {
        this.clientId = clientId;
        this.teamId = teamId;
        this.keyId = keyId;
        this.privateKey = privateKey;
        this.baseUrl = baseUrl;
    }

    @PostConstruct
    void warnIfDisabled() {
        if (!enabled()) {
            log.warn("Apple 토큰 폐기 비활성 — APPLE_TEAM_ID·APPLE_KEY_ID·APPLE_PRIVATE_KEY 미설정, 탈퇴 시 폐기를 건너뛴다");
        }
    }

    /** 절대 던지지 않는다. */
    public void revoke(UUID userId, String authorizationCode) {
        if (!enabled()) {
            log.warn("Apple 토큰 폐기 건너뜀(설정 없음) — userId={}", userId);
            return;
        }
        try {
            String secret = clientSecret(clientId, teamId, keyId, privateKey, Instant.now());
            JsonNode token = post(userId, "/auth/token", form("client_id", clientId, "client_secret", secret,
                    "code", authorizationCode, "grant_type", "authorization_code"));
            if (token == null) {
                return;
            }
            String refresh = text(token, "refresh_token");
            String revoked = refresh != null ? refresh : text(token, "access_token");
            if (revoked == null) {
                log.warn("Apple 토큰 교환 응답에 토큰 없음 — userId={}", userId);
                return;
            }
            post(userId, "/auth/revoke", form("client_id", clientId, "client_secret", secret, "token", revoked,
                    "token_type_hint", refresh != null ? "refresh_token" : "access_token"));
        } catch (Exception e) {
            // 메시지에 비밀이 섞일 수 있어 클래스만 남긴다.
            log.warn("Apple 토큰 폐기 실패 — userId={}, {}", userId, e.getClass().getSimpleName());
        }
    }

    private boolean enabled() {
        return !teamId.isBlank() && !keyId.isBlank() && !privateKey.isBlank();
    }

    /** 2xx 면 본문(빈 본문은 빈 객체), 아니면 WARN 후 null. */
    private JsonNode post(UUID userId, String path, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            log.warn("Apple 토큰 폐기 실패 — userId={}, path={}, status={}", userId, path, response.statusCode());
            return null;
        }
        return response.body().isBlank() ? mapper.createObjectNode() : mapper.readTree(response.body());
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isString() && !value.stringValue().isBlank() ? value.stringValue() : null;
    }

    private static String form(String... pairs) {
        Map<String, String> fields = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            fields.put(pairs[i], pairs[i + 1]);
        }
        return fields.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    /** Apple 이 요구하는 ES256 client_secret JWT(수명 5분). */
    static String clientSecret(String clientId, String teamId, String keyId, String pem, Instant now)
            throws Exception {
        // 환경변수는 개행이 리터럴 \n 으로 오기도 한다.
        String base64 = pem.replace("\\n", "\n")
                .replaceAll("-----(BEGIN|END) [A-Z ]+-----", "").replaceAll("\\s", "");
        PrivateKey key = KeyFactory.getInstance("EC")
                .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(base64)));
        return Jwts.builder().header().keyId(keyId).and()
                .issuer(teamId).subject(clientId).audience().single(AUDIENCE)
                .issuedAt(Date.from(now)).expiration(Date.from(now.plus(Duration.ofMinutes(5))))
                .signWith(key, Jwts.SIG.ES256).compact();
    }
}

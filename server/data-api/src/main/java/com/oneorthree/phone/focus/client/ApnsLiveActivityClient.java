package com.oneorthree.phone.focus.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.net.URI;
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
import java.util.Map;

/** Live Activity 전용 APNs HTTP/2. 키·토큰·응답 본문은 로그에 남기지 않는다. */
@Component
@Slf4j
public class ApnsLiveActivityClient implements LiveActivityPushClient {
    private final String teamId;
    private final String keyId;
    private final PrivateKey key;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http;
    private String jwt;
    private Instant jwtExpiresAt = Instant.EPOCH;

    @Autowired
    public ApnsLiveActivityClient(
            @Value("${focus.live-activity.apns.team-id:${FOCUS_LIVE_ACTIVITY_APNS_TEAM_ID:}}") String teamId,
            @Value("${focus.live-activity.apns.key-id:${FOCUS_LIVE_ACTIVITY_APNS_KEY_ID:}}") String keyId,
            @Value("${focus.live-activity.apns.key-base64:${FOCUS_LIVE_ACTIVITY_APNS_KEY_BASE64:}}") String keyBase64) {
        this(teamId, keyId, keyBase64, HttpClient.newBuilder().version(HttpClient.Version.HTTP_2)
                .connectTimeout(Duration.ofSeconds(3)).build());
    }

    ApnsLiveActivityClient(String teamId, String keyId, String keyBase64, HttpClient http) {
        this.http = http;
        this.teamId = teamId;
        this.keyId = keyId;
        if (teamId.isBlank() || keyId.isBlank() || keyBase64.isBlank()) {
            key = null;
            return;
        }
        try {
            String pem = new String(Base64.getDecoder().decode(keyBase64), StandardCharsets.UTF_8);
            byte[] der = Base64.getDecoder().decode(pem.replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", ""));
            key = KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (Exception e) {
            throw new IllegalStateException("Live Activity APNs 키 형식이 올바르지 않습니다");
        }
    }

    @Override
    public boolean enabled() {
        return key != null;
    }

    private synchronized String authorization() {
        Instant now = Instant.now();
        if (jwt == null || !now.isBefore(jwtExpiresAt)) {
            jwt = Jwts.builder().header().keyId(keyId).and().issuer(teamId).issuedAt(Date.from(now))
                    .signWith(key, Jwts.SIG.ES256).compact();
            jwtExpiresAt = now.plusSeconds(50 * 60);
        }
        return jwt;
    }

    @Override
    public Result send(String token, String environment, Map<String, Object> payload) {
        if (!enabled()) {
            return Result.RETRY;
        }
        String host = "development".equals(environment) ? "api.sandbox.push.apple.com" : "api.push.apple.com";
        try {
            // 종료는 잠깐 오프라인이어도 APNs가 보관한다. 중간 갱신은 오래된 상태를 쌓지 않는다.
            boolean ending = payload.get("aps") instanceof Map<?, ?> aps && "end".equals(aps.get("event"));
            String expiration = ending ? Long.toString(Instant.now().plusSeconds(8 * 3600).getEpochSecond()) : "0";
            HttpRequest request = HttpRequest.newBuilder(URI.create("https://" + host + "/3/device/" + token))
                    .timeout(Duration.ofSeconds(5))
                    .header("authorization", "bearer " + authorization())
                    .header("apns-topic", "com.oneorthree.focuscat.push-type.liveactivity")
                    .header("apns-push-type", "liveactivity")
                    .header("apns-priority", "10")
                    .header("apns-expiration", expiration)
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload))).build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                return Result.SENT;
            }
            String reason = json.readTree(response.body()).path("reason").asText();
            if (response.statusCode() == 410 || "BadDeviceToken".equals(reason)
                    || "DeviceTokenNotForTopic".equals(reason)) {
                return Result.INVALID_TOKEN;
            }
            log.warn("Live Activity APNs 전송 실패: status={}", response.statusCode());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.warn("Live Activity APNs 통신 실패: {}", e.getClass().getSimpleName());
        }
        return Result.RETRY;
    }
}

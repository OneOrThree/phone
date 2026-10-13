package com.oneorthree.phone.focus.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.auth.oauth2.GoogleCredentials;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;

/** 이미 표시 중인 집중 알림 갱신용 FCM data 메시지. 인증 값·토큰·응답 본문은 기록하지 않는다. */
@Component
@Slf4j
public class FcmFocusActivityClient {
    private final GoogleCredentials credentials;
    private final String projectId;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    public FcmFocusActivityClient(
            @Value("${fcm.project-id:${FCM_PROJECT_ID:}}") String projectId,
            @Value("${fcm.service-account-json:${FCM_SERVICE_ACCOUNT_JSON:}}") String key) {
        this.projectId = projectId;
        if (projectId.isBlank() || key.isBlank()) {
            credentials = null;
        } else {
            try {
                credentials = GoogleCredentials.fromStream(new ByteArrayInputStream(Base64.getDecoder().decode(key)))
                        .createScoped("https://www.googleapis.com/auth/firebase.messaging");
            } catch (Exception e) {
                throw new IllegalStateException("집중 상태 FCM 인증 설정이 올바르지 않습니다");
            }
        }
    }

    public boolean enabled() {
        return credentials != null && projectId.matches("[a-z][a-z0-9-]{4,62}");
    }

    private synchronized String accessToken() throws java.io.IOException {
        credentials.refreshIfExpired();
        return credentials.getAccessToken().getTokenValue();
    }

    public LiveActivityPushClient.Result send(String token, Map<String, Object> payload) {
        if (!enabled()) {
            return LiveActivityPushClient.Result.RETRY;
        }
        try {
            var body = Map.of("message", Map.of("token", token,
                    "data", Map.of("focusActivity", json.writeValueAsString(payload)),
                    "android", Map.of("priority", "high", "ttl", "2419200s",
                            "collapse_key", "focus-" + payload.get("sessionId"))));
            var request = HttpRequest.newBuilder(URI.create("https://fcm.googleapis.com/v1/projects/"
                            + projectId + "/messages:send"))
                    .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + accessToken())
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
            var response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                return LiveActivityPushClient.Result.SENT;
            }
            var details = json.readTree(response.body()).path("error").path("details");
            for (var detail : details) {
                if ("UNREGISTERED".equals(detail.path("errorCode").asText())) {
                    return LiveActivityPushClient.Result.INVALID_TOKEN;
                }
            }
            log.warn("집중 상태 FCM 전송 실패: status={}", response.statusCode());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.warn("집중 상태 FCM 통신 실패: {}", e.getClass().getSimpleName());
        }
        return LiveActivityPushClient.Result.RETRY;
    }
}

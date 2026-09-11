package com.oneorthree.notification;

import com.google.auth.oauth2.GoogleCredentials;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
@Profile("!ci")
class FcmTransport implements PushTransport {

    private final GoogleCredentials credentials;
    private final RestClient client;
    private final String project;

    FcmTransport(@Value("${fcm.project-id:}") String project,
            @Value("${fcm.service-account-json:}") String encoded) {
        ServiceAuth.require(project, "FCM_PROJECT_ID");
        ServiceAuth.require(encoded, "FCM_SERVICE_ACCOUNT_JSON");
        this.project = project;
        try {
            credentials = GoogleCredentials.fromStream(new ByteArrayInputStream(Base64.getDecoder().decode(encoded)))
                    .createScoped("https://www.googleapis.com/auth/firebase.messaging");
        } catch (IOException | IllegalArgumentException invalid) {
            throw new IllegalStateException("FCM 서비스 계정 형식 오류", invalid);
        }
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(4));
        client = RestClient.builder().baseUrl("https://fcm.googleapis.com").requestFactory(factory).build();
    }

    @Override
    public Result send(String token, RenderedPush push, boolean sound, String eventId) {
        try {
            credentials.refreshIfExpired();
            client.post().uri("/v1/projects/{project}/messages:send", project)
                    .header("Authorization", "Bearer " + credentials.getAccessToken().getTokenValue())
                    .contentType(MediaType.APPLICATION_JSON).body(payload(token, push, sound, eventId))
                    .retrieve().toBodilessEntity();
            return Result.SENT;
        } catch (RestClientResponseException failure) {
            return isUnregistered(failure.getStatusCode().value(), failure.getResponseBodyAsString())
                    ? Result.UNREGISTERED : Result.RETRY;
        } catch (IOException | org.springframework.web.client.RestClientException unavailable) {
            return Result.RETRY;
        }
    }

    static boolean isUnregistered(int status, String body) {
        if (status != 404) {
            return false;
        }
        try {
            Object details = Json.map(Json.map(body).get("error")).get("details");
            if (details instanceof List<?> list) {
                return list.stream().filter(item -> item instanceof Map<?, ?>).map(Json::map).anyMatch(item ->
                        "type.googleapis.com/google.firebase.fcm.v1.FcmError".equals(item.get("@type"))
                                && "UNREGISTERED".equals(item.get("errorCode")));
            }
        } catch (RuntimeException invalid) {
            return false;
        }
        return false;
    }

    static Map<String, Object> payload(String token, RenderedPush push, boolean sound, String eventId) {
        Map<String, Object> message = new LinkedHashMap<>();
        Map<String, String> data = new LinkedHashMap<>(push.data());
        data.put("eventId", eventId);
        message.put("token", token);
        message.put("data", data);
        String collapse = Json.digest(eventId);
        if (push.silent()) {
            message.put("apns", Map.of("headers", Map.of("apns-push-type", "background", "apns-priority", "5"),
                    "payload", Map.of("aps", Map.of("content-available", 1))));
            message.put("android", Map.of("priority", "HIGH"));
        } else {
            message.put("notification", Map.of("title", push.title(), "body", push.body()));
            message.put("apns", Map.of("headers", Map.of("apns-collapse-id", collapse),
                    "payload", Map.of("aps", sound ? Map.of("sound", "default") : Map.of())));
            message.put("android", Map.of("notification", Map.of("tag", collapse)));
        }
        return Map.of("message", message);
    }
}

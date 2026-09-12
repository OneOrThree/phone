package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/** Data 조회 세 종류만 제공한다. 위성에서 Data 명령을 실행할 API는 없다. */
@Component
class DataClient {

    private final RestClient http;

    DataClient(@Value("${notification.data-url:}") String url,
            @Value("${notification.data-token:}") String token) {
        ServiceAuth.require(url, "DATA_API_BASE_URL");
        ServiceAuth.require(token, "SVC_TOKEN_NOTI_TO_DATA");
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(1));
        factory.setReadTimeout(Duration.ofSeconds(2));
        http = RestClient.builder().baseUrl(url).requestFactory(factory)
                .defaultHeader("Authorization", "Bearer " + token).build();
    }

    boolean acknowledged(UUID user, UUID session) {
        String body = http.get().uri(builder -> builder.path("/internal/users/{id}/result-ack")
                .queryParam("sessionId", session).build(user))
                .header("X-User-Id", user.toString()).retrieve().body(String.class);
        return Json.bool(Json.map(body), "acknowledged");
    }

    Map<String, Object> snapshot(String cursor, int limit) {
        String body = http.get().uri(builder -> builder.path("/internal/users/notification-snapshot")
                .queryParamIfPresent("cursor", java.util.Optional.ofNullable(cursor))
                .queryParam("limit", limit).build())
                .retrieve().body(String.class);
        return Json.map(body);
    }

    boolean eligible(UUID user, String kind, String subject, Map<String, Object> params) {
        return eligibility(Map.of("userId", user, "kind", kind, "subjectId", subject == null ? "" : subject,
                "params", params));
    }

    /** 시험 정본에서만 얻은 생성 시각이다. 일반 사건 params를 승격하지 않는다. */
    boolean eligibleTest(UUID user, String kind, String subject, Map<String, Object> params,
            java.time.Instant requestedAt) {
        return eligibility(Map.of("userId", user, "kind", kind, "subjectId", subject == null ? "" : subject,
                "params", params, "adminTestRequestedAt", requestedAt.toString()));
    }

    private boolean eligibility(Map<String, Object> request) {
        String body = http.post().uri("/internal/notifications/eligibility")
                .body(request).retrieve().body(String.class);
        return Json.bool(Json.map(body), "eligible");
    }
}

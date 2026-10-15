package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
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

    boolean acknowledged(UUID user, UUID session, Instant ackDeadlineAt) {
        String body = http.get().uri(builder -> builder.path("/internal/users/{id}/result-ack")
                .queryParam("sessionId", session).queryParam("ackDeadlineAt", ackDeadlineAt.toString()).build(user))
                .header("X-User-Id", user.toString()).retrieve().body(String.class);
        Map<String, Object> response = decision(body, "acknowledged");
        boolean acknowledged = (boolean) response.get("acknowledged");
        Object at = response.get("acknowledgedAt");
        if (acknowledged) {
            if (!(at instanceof String timestamp)) {
                throw new NotificationFailure(502, "UPSTREAM_CONTRACT_MISMATCH");
            }
            try {
                Instant.parse(timestamp);
            } catch (DateTimeParseException invalid) {
                throw new NotificationFailure(502, "UPSTREAM_CONTRACT_MISMATCH");
            }
        } else if (at != null) {
            throw new NotificationFailure(502, "UPSTREAM_CONTRACT_MISMATCH");
        }
        return acknowledged;
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
        Map<String, Object> response = decision(body, "eligible");
        boolean eligible = (boolean) response.get("eligible");
        Object reason = response.get("reason");
        if ((eligible && reason != null)
                || (!eligible && (!(reason instanceof String code) || code.isBlank()))) {
            throw new NotificationFailure(502, "UPSTREAM_CONTRACT_MISMATCH");
        }
        return eligible;
    }

    /** HTTP 성공이어도 판정 본문·boolean이 불완전하면 발송/보류 상태를 확정하지 않는다. */
    private static Map<String, Object> decision(String body, String flag) {
        try {
            Map<String, Object> response = Json.map(body);
            Json.bool(response, flag);
            return response;
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(502, "UPSTREAM_CONTRACT_MISMATCH");
        }
    }
}

package com.oneorthree.notification;

import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/** 사용자 스냅샷과 발송 적격 조회만 제공한다. 위성에서 Data 명령을 실행할 API는 없다. */
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
                .defaultHeader("Authorization", "Bearer " + token)
                .requestInterceptor(DataClient::carryOrigin).build();
    }

    /**
     * 발송 스레드의 원인 문맥(MDC)을 Data 로 넘긴다(GROMO-2582) — Data 가 이어받아 T1→T2→T3 에서 최초 origin 을 유지한다.
     * 값은 보내기 전에 수신 쪽과 같은 형식 검사를 거치고, 어긋나면 그 헤더만 뺀다. 문맥이 없으면 헤더를 달지 않는다.
     */
    private static ClientHttpResponse carryOrigin(HttpRequest request, byte[] body, ClientHttpRequestExecution next)
            throws IOException {
        String requestId = InboundTrace.safeId(MDC.get("origin_request_id"));
        String traceId = InboundTrace.safeTrace(MDC.get("origin_trace_id"));
        if (requestId != null) {
            request.getHeaders().set("X-Origin-Request-Id", requestId);
        }
        if (traceId != null) {
            request.getHeaders().set("X-Origin-Trace-Id", traceId);
        }
        if (requestId != null || traceId != null) {
            request.getHeaders().set("X-Trace-Context-Version", "1");
        }
        return next.execute(request, body);
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

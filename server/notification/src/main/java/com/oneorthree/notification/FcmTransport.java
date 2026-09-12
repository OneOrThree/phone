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
import java.util.stream.Stream;

@Component
@Profile("!ci")
class FcmTransport implements PushTransport {

    /** 어느 필드가 잘못됐는지 FCM 이 짚어 주는 상세의 타입. */
    private static final String BAD_REQUEST = "type.googleapis.com/google.rpc.BadRequest";

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
            return unusableToken(failure.getStatusCode().value(), failure.getResponseBodyAsString())
                    ? Result.UNREGISTERED : Result.RETRY;
        } catch (IOException | org.springframework.web.client.RestClientException unavailable) {
            return Result.RETRY;
        }
    }

    /**
     * 이 토큰으로는 더 보낼 수 없는가 — 그렇다면 호출부가 전송 자격을 내린다({@code transport_invalid}).
     *
     * <p>FCM 은 «못 쓰는 토큰»을 한 가지 모양으로만 돌려주지 않는다. 이미 해지된 토큰은
     * {@code 404 UNREGISTERED} 지만, <b>형식이 깨진 등록 토큰은 {@code 400 INVALID_ARGUMENT}</b> 다.
     * 뒤의 것을 재시도로 돌리면 그 토큰의 모든 delivery 가 매분 영구 재시도되고 미전달 행만 쌓인다 —
     * 구 {@code FcmPushNotificationClient} 는 그 응답을 무효 토큰으로 정리해 왔으므로, 정리하지 않는
     * 것은 서버를 가르면서 생긴 회귀다.
     *
     * @param status HTTP 상태
     * @param body   응답 본문
     * @return 정리 대상인가
     */
    static boolean unusableToken(int status, String body) {
        return isUnregistered(status, body) || isInvalidToken(status, body);
    }

    /**
     * {@code 400 INVALID_ARGUMENT} 가 «토큰 때문»인가.
     *
     * <p>페이로드가 잘못돼도 FCM 은 같은 {@code INVALID_ARGUMENT} 를 돌려준다. 그것까지 토큰 무효로
     * 오판하면 <b>페이로드 버그 하나가 멀쩡한 기기의 등록을 통째로 지운다</b> — 그래서 FCM 이 어느
     * 필드가 문제인지 짚어 줬으면 그 말을 따르고, 토큰이 아닌 필드를 짚었으면 토큰을 건드리지 않는다.
     *
     * <p>짚어 주지 않은 {@code INVALID_ARGUMENT} 는 토큰으로 본다. 이 페이로드에서 요청마다 달라지는
     * 값은 토큰뿐이고(나머지는 렌더 테스트가 고정한다), 구 경로도 같은 판정을 해 왔다.
     *
     * @param status HTTP 상태
     * @param body   응답 본문
     * @return 토큰 때문인가
     */
    static boolean isInvalidToken(int status, String body) {
        if (status != 400) {
            return false;
        }
        try {
            Map<String, Object> error = Json.map(Json.map(body).get("error"));
            if (!"INVALID_ARGUMENT".equals(error.get("status"))) {
                return false;
            }
            List<Map<String, Object>> violations = fieldViolations(error.get("details"));
            return violations.isEmpty() || violations.stream().anyMatch(FcmTransport::pointsAtToken);
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    /** @return 상세에 실린 필드 위반 목록 — 없거나 모양이 다르면 빈 목록 */
    private static List<Map<String, Object>> fieldViolations(Object details) {
        if (!(details instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().filter(item -> item instanceof Map<?, ?>).map(Json::map)
                .filter(item -> BAD_REQUEST.equals(item.get("@type")))
                .flatMap(item -> item.get("fieldViolations") instanceof List<?> violations
                        ? violations.stream() : Stream.empty())
                .filter(item -> item instanceof Map<?, ?>).map(Json::map).toList();
    }

    /** @return 이 위반이 토큰 필드를 짚는가 — {@code message.token}·{@code token} 어느 표기든 받는다 */
    private static boolean pointsAtToken(Map<String, Object> violation) {
        Object field = violation.get("field");
        if (field == null) {
            return false;
        }
        String name = field.toString();
        return "token".equalsIgnoreCase(name.substring(name.lastIndexOf('.') + 1));
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
            Map<String, String> notification = new LinkedHashMap<>();
            if (push.title() != null) {
                notification.put("title", push.title());
            }
            notification.put("body", push.body());
            message.put("notification", notification);
            message.put("apns", Map.of("headers", Map.of("apns-collapse-id", collapse),
                    "payload", Map.of("aps", sound ? Map.of("sound", "default") : Map.of())));
            message.put("android", Map.of("notification", Map.of("tag", collapse)));
        }
        return Map.of("message", message);
    }
}

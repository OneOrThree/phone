package com.oneorthree.notification;

import com.google.auth.oauth2.GoogleCredentials;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

@Slf4j
@Component
@Profile("!ci")
class FcmTransport implements PushTransport {

    /** 어느 필드가 잘못됐는지 FCM 이 짚어 주는 상세의 타입. */
    private static final String BAD_REQUEST = "type.googleapis.com/google.rpc.BadRequest";

    private final GoogleCredentials credentials;
    private final RestClient client;
    private final String project;
    private final Counter senderMismatch;
    private final NotificationEnvironmentGuard environmentGuard;

    @Autowired
    public FcmTransport(@Value("${fcm.project-id:}") String project,
            @Value("${fcm.service-account-json:}") String encoded, MeterRegistry registry,
            NotificationEnvironmentGuard environmentGuard) {
        this(project, credentials(project, encoded), "https://fcm.googleapis.com", registry, environmentGuard);
    }

    FcmTransport(String project, GoogleCredentials credentials, String baseUrl, MeterRegistry registry) {
        this(project, credentials, baseUrl, registry, null);
    }

    FcmTransport(String project, GoogleCredentials credentials, String baseUrl, MeterRegistry registry,
            NotificationEnvironmentGuard environmentGuard) {
        this.project = project;
        this.credentials = credentials;
        this.client = client(baseUrl);
        this.senderMismatch = registry.counter("notification.fcm.sender_mismatch");
        this.environmentGuard = environmentGuard;
    }

    private static GoogleCredentials credentials(String project, String encoded) {
        ServiceAuth.require(project, "FCM_PROJECT_ID");
        ServiceAuth.require(encoded, "FCM_SERVICE_ACCOUNT_JSON");
        try {
            return GoogleCredentials.fromStream(new ByteArrayInputStream(Base64.getDecoder().decode(encoded)))
                    .createScoped("https://www.googleapis.com/auth/firebase.messaging");
        } catch (IOException | IllegalArgumentException invalid) {
            throw new IllegalStateException("FCM 서비스 계정 형식 오류", invalid);
        }
    }

    static RestClient client(String baseUrl) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(4));
        return RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @Override
    public Result send(String token, RenderedPush push, boolean sound, String eventId) {
        if (environmentGuard != null) {
            environmentGuard.assertDispatchReady();
        }
        // Dispatch는 이 검사를 임대·외부 호출 전에 한다. 다른 직접 호출도 크기 초과를 전송하지 않는다.
        Map<String, Object> payload = payload(token, push, sound, eventId);
        try {
            credentials.refreshIfExpired();
            client.post().uri("/v1/projects/{project}/messages:send", project)
                    .header("Authorization", "Bearer " + credentials.getAccessToken().getTokenValue())
                    .contentType(MediaType.APPLICATION_JSON).body(payload)
                    .retrieve().toBodilessEntity();
            return Result.SENT;
        } catch (RestClientResponseException failure) {
            int status = failure.getStatusCode().value();
            String body = failure.getResponseBodyAsString();
            String errorCode = fcmErrorCode(body);
            if (isSenderIdMismatch(status, body)) {
                senderMismatch.increment();
            }
            log.warn("FCM 발송 실패 status={} errorCode={} project={}", status, errorCode, project);
            return classify(status, body);
        } catch (IOException | org.springframework.web.client.RestClientException unavailable) {
            log.warn("FCM 발송 실패 status=unavailable errorCode=unknown project={} cause={}",
                    project, unavailable.getClass().getSimpleName());
            return Result.RETRY;
        }
    }

    /** @return FCM 오류 응답의 결과 — 토큰 고유 오류면 {@code UNREGISTERED}, 그 밖에는 재시도 */
    static Result classify(int status, String body) {
        return unusableToken(status, body) ? Result.UNREGISTERED : Result.RETRY;
    }

    /**
     * 이 토큰으로는 더 보낼 수 없는가 — 그렇다면 호출부가 전송 자격을 내린다({@code transport_invalid}).
     *
     * <p>FCM 은 «못 쓰는 토큰»을 한 가지 모양으로만 돌려주지 않는다. 이미 해지된 토큰은
     * {@code 404 UNREGISTERED} 지만, <b>형식이 깨진 등록 토큰은 {@code 400 INVALID_ARGUMENT}</b> 다.
     * 뒤의 것을 재시도로 돌리면 그 토큰의 모든 delivery 가 매분 상한까지 재시도되고 미전달 행만 쌓인다 —
     * 구 {@code FcmPushNotificationClient} 는 그 응답을 무효 토큰으로 정리해 왔으므로, 정리하지 않는
     * 것은 서버를 가르면서 생긴 회귀다.
     *
     * <p>다른 FCM 프로젝트에서 발급된 토큰({@code 403 SENDER_ID_MISMATCH})도 같은 길을 탄다 —
     * {@link #isSenderIdMismatch}.
     *
     * @param status HTTP 상태
     * @param body   응답 본문
     * @return 정리 대상인가
     */
    static boolean unusableToken(int status, String body) {
        return isUnregistered(status, body) || isInvalidToken(status, body) || isSenderIdMismatch(status, body);
    }

    /**
     * {@code 400 INVALID_ARGUMENT} 가 «토큰 때문»인가.
     *
     * <p>페이로드가 잘못돼도 FCM 은 같은 {@code INVALID_ARGUMENT} 를 돌려준다. 그것까지 토큰 무효로
     * 오판하면 <b>페이로드 버그 하나가 멀쩡한 기기의 등록을 통째로 지운다</b> — 그래서 FCM 이 어느
     * 필드가 문제인지 짚어 줬으면 그 말을 따르고, 토큰이 아닌 필드를 짚었으면 토큰을 건드리지 않는다.
     *
     * <p>어느 필드인지 짚지 않은 응답은 토큰 무효의 증거가 아니다. 운영 템플릿·인자·딥링크가
     * 바뀌므로 크기 외의 페이로드 오류도 가능하다. 토큰 필드를 명시한 경우에만 정리한다.
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
            return violations.stream().anyMatch(FcmTransport::pointsAtToken);
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
        return "token".equals(name) || "message.token".equals(name);
    }

    static boolean isUnregistered(int status, String body) {
        return status == 404 && hasFcmErrorCode(body, "UNREGISTERED");
    }

    /**
     * {@code 403 SENDER_ID_MISMATCH} — 이 토큰은 «다른 FCM 프로젝트»에서 발급됐다.
     *
     * <p>앱의 {@code GoogleService-Info.plist} 프로젝트가 서버의 {@code FCM_PROJECT_ID} 와 다르면, 그 앱이
     * 받은 토큰은 이 서버 프로젝트로 영원히 보낼 수 없다. 재시도로 돌리면 {@code retry} 가 60초마다 같은
     * 토큰으로 다시 보내므로, 이벤트 만료가 없는 알림도 상한까지 불필요하게 재시도한다.
     *
     * <p>토큰 고유 오류라 {@code UNREGISTERED} 와 같은 길이다 — 전송 자격({@code transport_invalid})만 내리고
     * 소유권({@code active})은 유지해, 앱이 올바른 프로젝트의 새 토큰을 올리면 CAS 로 교체된다.
     *
     * <p>상태만 보고 판정하지 않는다. 같은 403 이라도 서버 자격·권한 문제({@code PERMISSION_DENIED})는 토큰
     * 탓이 아니고, {@code THIRD_PARTY_AUTH_ERROR}(APNs 키·인증서)는 서버 설정 오류라 둘 다 재시도로 남긴다.
     *
     * @param status HTTP 상태
     * @param body   응답 본문
     * @return 프로젝트가 다른 토큰인가
     */
    static boolean isSenderIdMismatch(int status, String body) {
        return status == 403 && hasFcmErrorCode(body, "SENDER_ID_MISMATCH");
    }

    /** @return 응답 상세의 {@code FcmError} 가 이 errorCode 를 돌려줬는가 — 본문이 JSON 이 아니면 아니다 */
    private static boolean hasFcmErrorCode(String body, String errorCode) {
        try {
            Object details = Json.map(Json.map(body).get("error")).get("details");
            if (details instanceof List<?> list) {
                return list.stream().filter(item -> item instanceof Map<?, ?>).map(Json::map).anyMatch(item ->
                        "type.googleapis.com/google.firebase.fcm.v1.FcmError".equals(item.get("@type"))
                                && errorCode.equals(item.get("errorCode")));
            }
        } catch (RuntimeException invalid) {
            return false;
        }
        return false;
    }

    private static String fcmErrorCode(String body) {
        try {
            Object details = Json.map(Json.map(body).get("error")).get("details");
            if (details instanceof List<?> list) {
                return list.stream().filter(item -> item instanceof Map<?, ?>).map(Json::map).filter(item ->
                        "type.googleapis.com/google.firebase.fcm.v1.FcmError".equals(item.get("@type"))
                                && item.get("errorCode") instanceof String)
                        .map(item -> item.get("errorCode").toString()).findFirst().orElse("unknown");
            }
        } catch (RuntimeException invalid) {
            return "unknown";
        }
        return "unknown";
    }

    static Map<String, Object> payload(String token, RenderedPush push, boolean sound, String eventId) {
        return FcmPayload.create(token, push, sound, eventId);
    }
}

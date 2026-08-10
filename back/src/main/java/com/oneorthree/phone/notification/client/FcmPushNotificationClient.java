package com.oneorthree.phone.notification.client;

import com.google.auth.oauth2.GoogleCredentials;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.common.port.PushSendResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * FCM HTTP v1 발송 클라이언트 (GROMO-528) — dev·staging·prod 프로파일 전용.
 * firebase-admin 미도입(확정) — RestClient(auth/client 선례) + google-auth-library-oauth2-http.
 * 발송: POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
 */
@Slf4j
@Component
@Profile({"dev", "staging", "prod"})
public class FcmPushNotificationClient implements PushNotificationPort {

    private static final String FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
    private static final String FCM_BASE_URL = "https://fcm.googleapis.com";

    private final RestClient restClient;
    private final GoogleCredentials credentials;
    private final String projectId;

    public FcmPushNotificationClient(
            // 프로퍼티 키는 env 자동 변환(FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON)과 정확히 일치해야 함
            // — application.yml 이 gitignore 라 이미지에 없어도 env 만으로 해석되도록. 기본값 : 은 미설정 시
            //   플레이스홀더 미해석 대신 아래 fail-fast 메시지를 태우기 위함 (PR #107 리뷰 반영)
            @Value("${fcm.project-id:}") String projectId,
            @Value("${fcm.service-account-json:}") String serviceAccountJsonBase64) {
        // 배선 실수(시크릿 미등록)를 기동 시점에 드러낸다 — fail-fast
        if (projectId == null || projectId.isBlank()
                || serviceAccountJsonBase64 == null || serviceAccountJsonBase64.isBlank()) {
            throw new IllegalStateException(
                    "FCM 설정 누락 — FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON 시크릿을 확인하세요");
        }
        this.projectId = projectId;
        byte[] serviceAccountJson = Base64.getDecoder().decode(serviceAccountJsonBase64);
        try {
            this.credentials = GoogleCredentials
                    .fromStream(new ByteArrayInputStream(serviceAccountJson))
                    .createScoped(FCM_SCOPE);
        } catch (IOException e) {
            throw new IllegalStateException("FCM 서비스 계정 키 파싱 실패 — base64/JSON 형식을 확인하세요", e);
        }
        // 선례: auth/client 의 RestClient 직조립 — 발송 경로는 send()에서 /v1/projects/{id}/messages:send
        this.restClient = RestClient.builder().baseUrl(FCM_BASE_URL).build();
    }


    @Override
    public PushSendResult send(String deviceToken, PushMessage message) {
        try {
            // ① 서비스 계정 액세스 토큰 (만료 시에만 갱신 — 라이브러리가 캐싱)
            credentials.refreshIfExpired();
            String accessToken = credentials.getAccessToken().getTokenValue();

            // ②③ 조립 후 발송 — 200 이면 예외 없이 통과
            restClient.post()
                    .uri("/v1/projects/{projectId}/messages:send", projectId)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(buildMessagePayload(deviceToken, message))
                    .retrieve()
                    .toBodilessEntity();
            return PushSendResult.SENT;
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            String body = e.getResponseBodyAsString();
            // 무효 토큰 → 호출측이 deviceToken 정리 (정상 흐름)
            if ((status == 404 && body.contains("UNREGISTERED"))
                    || (status == 400 && body.contains("INVALID_ARGUMENT"))) {
                log.info("FCM 무효 토큰 — status={}", status);
                return PushSendResult.INVALID_TOKEN;
            }
            if (status == 401 || status == 403) {
                // 서비스 계정 키 오설정 — 운영 알람 대상
                log.error("FCM 인증/권한 실패 — 서비스 계정 키 설정 확인 필요 (status={}, body={})", status, body);
            } else {
                log.warn("FCM 발송 실패 — status={}, body={}", status, body);
            }
            return PushSendResult.FAILED;
        } catch (Exception e) {
            log.warn("FCM 발송 중 예외 — {}", e.getMessage(), e);
            return PushSendResult.FAILED;
        }
    }

    /**
     * FCM HTTP v1 메시지 페이로드 조립 — package-private (단위 테스트 대상).
     * soundEnabled true 일 때만 apns.payload.aps.sound = "default" 포함.
     *
     * <p><b>사일런트(data-only, GROMO-1281)</b>: notification 블록을 빼고 data 만 싣는다.
     * iOS 는 {@code aps.content-available=1} + 헤더 {@code apns-push-type: background} ·
     * {@code apns-priority: 5}(Apple 이 background 푸시에 요구하는 조합)로 앱을 깨우고,
     * Android 는 data-only 메시지의 기본 우선순위가 normal 이라 Doze 에서 지연되므로
     * {@code priority: HIGH} 로 올린다 — 그레이스 30분 안에 flush 가 도착해야 정산이 데이터를 본다.
     */
    Map<String, Object> buildMessagePayload(String deviceToken, PushMessage message) {
        Map<String, Object> fcmMessage = new LinkedHashMap<>();
        fcmMessage.put("token", deviceToken);
        if (message.isSilent()) {
            fcmMessage.put("data", message.toDataPayload());
            fcmMessage.put("apns", Map.of(
                    "headers", Map.of("apns-push-type", "background", "apns-priority", "5"),
                    "payload", Map.of("aps", Map.of("content-available", 1))));
            fcmMessage.put("android", Map.of("priority", "HIGH"));
            return Map.of("message", fcmMessage);
        }
        fcmMessage.put("notification", Map.of("title", message.title(), "body", message.body()));
        // data = 추가 키(type·groupId 등) + link. 종전 트리거는 추가 키가 없어 {"link": …} 그대로다.
        fcmMessage.put("data", message.toDataPayload());
        if (message.soundEnabled()) {
            fcmMessage.put("apns", Map.of("payload", Map.of("aps", Map.of("sound", "default"))));
        }
        return Map.of("message", fcmMessage);
    }
}

package com.oneorthree.notification;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** FCM 단일 기기 봉투와 크기 검사. 템플릿 샘플과 실제 발송이 같은 직렬화 결과를 검사한다. */
final class FcmPayload {
    private static final int MAX_BYTES = 4096;

    private FcmPayload() {
    }

    static void requireFits(RenderedPush push, boolean sound, String eventId) {
        create("", push, sound, eventId);
    }

    static Map<String, Object> create(String token, RenderedPush push, boolean sound, String eventId) {
        Map<String, Object> message = new LinkedHashMap<>();
        Map<String, String> data = new LinkedHashMap<>(push.data());
        data.put("eventId", eventId);
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
        // https://firebase.google.com/docs/cloud-messaging/error-codes — keys와 values도 4096byte에 포함된다.
        // 라우팅 token을 제외한 최종 JSON 전체를 세어 플랫폼 설정·이스케이프까지 보수적으로 포함한다.
        // String.length()는 한글·이모지의 UTF-8 크기를 세지 못한다.
        if (Json.write(Map.of("message", message)).getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new NotificationFailure(422, "FCM_PAYLOAD_TOO_LARGE");
        }
        message.put("token", token);
        return Map.of("message", message);
    }
}

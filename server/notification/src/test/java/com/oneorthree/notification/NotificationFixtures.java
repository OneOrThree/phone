package com.oneorthree.notification;

import com.oneorthree.notification.common.Json;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class NotificationFixtures {
    public static final Instant DAY = Instant.parse("2026-09-11T03:00:00Z");
    private NotificationFixtures() {
    }

    public static Map<String, Object> preferences(boolean enabled) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("notificationEnabled", enabled);
        values.put("soundEnabled", true);
        values.put("nightModeEnabled", false);
        values.put("nightStartTime", null);
        values.put("nightEndTime", null);
        return values;
    }
    public static Map<String, Object> event(String id, String type, UUID user, long version, String subject,
            Map<String, Object> params) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("eventId", id);
        value.put("schemaVersion", 1);
        value.put("type", type);
        value.put("userId", user.toString());
        value.put("version", version);
        value.put("subjectId", subject);
        value.put("locale", "ko");
        value.put("occurredAt", DAY.toString());
        value.put("scheduledAt", DAY.toString());
        value.put("params", params);
        return value;
    }

    /** FCM v1 이 돌려주는 실제 오류 모양 — HTTP 상태, gRPC status, 상세의 {@code FcmError.errorCode}. */
    public static String fcmError(int code, String status, String errorCode) {
        return Json.write(Map.of("error", Map.of("code", code, "status", status, "details", List.of(
                Map.of("@type", "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode", errorCode)))));
    }
}

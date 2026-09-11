package com.oneorthree.notification;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 이관 레코드의 «정규형» 한 곳. Data(N2) 내보내기와 알림 서버 검증이 같은 함수를 보고 만든다.
 * 시각은 전부 epoch 밀리초 정수다 — ISO 문자열은 소수 자릿수 표기가 양쪽에서 갈려 체크섬이 달라진다.
 */
final class MigrationRecords {

    static final int MAX_RECORDS = 500;
    /** 이관이 다루는 자원 전부. Data manifest 는 0건이어도 이 셋을 «언제나» 싣는다. */
    static final List<String> RESOURCES = List.of("delivery", "device", "settings");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

    private MigrationRecords() { }

    /** 자원 이름 해석은 여기 한 곳. 문자열이 SQL 식별자로 흘러가는 경로는 없다. */
    static Map<String, Object> canonical(String resource, Map<String, Object> data) {
        return switch (resource) {
            case "settings" -> settings(data);
            case "device" -> device(data);
            case "delivery" -> delivery(data);
            default -> throw new NotificationFailure(400, "UNKNOWN_MIGRATION_RESOURCE");
        };
    }

    /** 레코드 키는 «서버가» 레코드에서 유도한다. 보낸 쪽 키를 그대로 믿으면 내보내기 버그가 조용히 통과한다. */
    static String recordKey(String resource, Map<String, Object> canonical) {
        return switch (resource) {
            case "settings" -> canonical.get("userId").toString();
            // FCM 토큰 원문을 원장(imports)에 한 벌 더 남기지 않는다.
            case "device" -> Json.digest(canonical.get("deviceToken").toString());
            case "delivery" -> canonical.get("eventId").toString();
            default -> throw new NotificationFailure(400, "UNKNOWN_MIGRATION_RESOURCE");
        };
    }

    static String checksum(Map<String, Object> canonical) {
        return Json.hash(canonical);
    }

    // ── 소스 레코드 → 정규형 ────────────────────────────────────────────

    private static Map<String, Object> settings(Map<String, Object> data) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("userId", Json.uuid(data, "userId").toString());
        record.put("version", Json.number(data, "version"));
        record.put("notificationEnabled", Json.bool(data, "notificationEnabled"));
        record.put("soundEnabled", Json.bool(data, "soundEnabled"));
        record.put("nightModeEnabled", Json.bool(data, "nightModeEnabled"));
        // 심야 두 시각은 nullable 이다. null 상태 자체가 대조 대상이다(§7.1 ③).
        record.put("nightStartTime", time(data, "nightStartTime"));
        record.put("nightEndTime", time(data, "nightEndTime"));
        return record;
    }

    private static Map<String, Object> device(Map<String, Object> data) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("deviceToken", Json.text(data, "deviceToken"));
        record.put("userId", Json.uuid(data, "userId").toString());
        record.put("authGeneration", Json.nullableNumber(data, "authGeneration"));
        record.put("active", Json.bool(data, "active"));
        return record;
    }

    private static Map<String, Object> delivery(Map<String, Object> data) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("eventId", Json.text(data, "eventId"));
        record.put("userId", Json.uuid(data, "userId").toString());
        record.put("kind", Json.text(data, "kind"));
        record.put("subjectId", Json.nullableText(data, "subjectId"));
        record.put("groupId", data.get("groupId") == null ? null : Json.uuid(data, "groupId").toString());
        record.put("slotAt", Json.nullableNumber(data, "slotAt"));
        record.put("locale", Json.nullableText(data, "locale"));
        record.put("status", status(String.valueOf(data.get("status"))));
        record.put("attempts", Json.number(data, "attempts"));
        record.put("nextAttemptAt", Json.number(data, "nextAttemptAt"));
        record.put("sentAt", Json.nullableNumber(data, "sentAt"));
        record.put("params", AdminCatalog.object(data, "params"));
        return record;
    }

    static String status(String value) {
        return switch (value) {
            case "PENDING", "DEFERRED", "SENT", "SUPPRESSED", "FAILED" -> value;
            default -> throw new NotificationFailure(400, "INVALID_STATUS");
        };
    }

    // ── 실제 DB 행 → 정규형 (검증은 이 쪽만 쓴다) ───────────────────────

    static Map<String, Object> fromSettings(Map<String, Object> row) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("userId", row.get("user_id").toString());
        record.put("version", ((Number) row.get("version")).longValue());
        record.put("notificationEnabled", row.get("notification_enabled"));
        record.put("soundEnabled", row.get("sound_enabled"));
        record.put("nightModeEnabled", row.get("night_mode_enabled"));
        record.put("nightStartTime", localTime(row.get("night_start_time")));
        record.put("nightEndTime", localTime(row.get("night_end_time")));
        return record;
    }

    static Map<String, Object> fromDevice(Map<String, Object> row) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("deviceToken", row.get("device_token"));
        record.put("userId", row.get("user_id").toString());
        record.put("authGeneration", row.get("auth_generation") == null ? null
                : ((Number) row.get("auth_generation")).longValue());
        record.put("active", row.get("active"));
        return record;
    }

    static Map<String, Object> fromDelivery(Map<String, Object> row) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("eventId", row.get("event_id"));
        record.put("userId", row.get("user_id").toString());
        record.put("kind", row.get("kind"));
        record.put("subjectId", row.get("subject_id"));
        record.put("groupId", row.get("group_id") == null ? null : row.get("group_id").toString());
        record.put("slotAt", millis(row.get("slot_at")));
        record.put("locale", row.get("locale"));
        record.put("status", row.get("status"));
        record.put("attempts", ((Number) row.get("attempts")).longValue());
        record.put("nextAttemptAt", millis(row.get("next_attempt_at")));
        record.put("sentAt", millis(row.get("sent_at")));
        record.put("params", Json.map(row.get("payload").toString()));
        return record;
    }

    // ── 값 해석 ─────────────────────────────────────────────────────────

    static Timestamp timestamp(Object millis) {
        return millis == null ? null : Timestamp.from(Instant.ofEpochMilli(((Number) millis).longValue()));
    }

    static UUID uuid(Object value) {
        return value == null ? null : UUID.fromString(value.toString());
    }

    private static Long millis(Object value) {
        return value == null ? null : ((Timestamp) value).toInstant().toEpochMilli();
    }

    private static String localTime(Object value) {
        if (value == null) {
            return null;
        }
        // LocalTime.toString() 은 초가 0이면 ":00" 을 생략한다. 서식을 고정해야 양쪽 체크섬이 맞는다.
        return (value instanceof java.sql.Time sql ? sql.toLocalTime() : LocalTime.parse(value.toString()))
                .format(TIME);
    }

    private static String time(Map<String, Object> data, String key) {
        String value = Json.nullableText(data, key);
        try {
            return value == null ? null : LocalTime.parse(value).format(TIME);
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(400, "INVALID_QUIET_TIME");
        }
    }
}

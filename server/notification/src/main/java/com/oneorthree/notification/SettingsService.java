package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
class SettingsService {

    private static final DateTimeFormatter API_TIME = DateTimeFormatter.ofPattern("HH:mm");
    private final Store store;

    SettingsService(Store store) {
        this.store = store;
    }

    @Transactional
    public Map<String, Object> apply(UUID user, Map<String, Object> body, long version, String key) {
        return store.command("settings:" + user, key, Map.of("body", body, "version", version), () -> {
            applyLocked(user, body, version);
            return Map.of("applied", true);
        });
    }

    void applyLocked(UUID user, Map<String, Object> body, long version) {
        boolean enabled = Json.bool(body, "notificationEnabled");
        boolean sound = Json.bool(body, "soundEnabled");
        boolean night = Json.bool(body, "nightModeEnabled");
        if (!body.containsKey("nightStartTime") || !body.containsKey("nightEndTime")) {
            throw new NotificationFailure(400, "FULL_SETTINGS_REQUIRED");
        }
        LocalTime start = time(body, "nightStartTime");
        LocalTime end = time(body, "nightEndTime");
        // imported_by 를 NULL 로 지운다 — 이 행의 주인이 «라이브»로 넘어왔다는 표식이다.
        // 이관은 같은 version 에서 자기가 만든 행만 다시 쓰므로(MigrationService.writeSettings),
        // 이 한 줄이 「뒤늦은 재적재가 라이브 변경을 되돌리는 일」을 닫는다.
        store.update("INSERT INTO settings(user_id,version,notification_enabled,sound_enabled,night_mode_enabled,"
                + "night_start_time,night_end_time) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
                + "version=EXCLUDED.version,notification_enabled=EXCLUDED.notification_enabled,"
                + "sound_enabled=EXCLUDED.sound_enabled,night_mode_enabled=EXCLUDED.night_mode_enabled,"
                + "night_start_time=EXCLUDED.night_start_time,night_end_time=EXCLUDED.night_end_time,"
                + "imported_by=NULL"
                + " WHERE settings.version<EXCLUDED.version", user, version, enabled, sound, night, start, end);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> read(UUID user) {
        Map<String, Object> row = store.one("SELECT * FROM settings WHERE user_id=?", user);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("notificationEnabled", row == null || Boolean.TRUE.equals(row.get("notification_enabled")));
        result.put("soundEnabled", row == null || Boolean.TRUE.equals(row.get("sound_enabled")));
        result.put("nightModeEnabled", row != null && Boolean.TRUE.equals(row.get("night_mode_enabled")));
        result.put("nightStartTime", row == null || row.get("night_start_time") == null
                ? null : LocalTime.parse(row.get("night_start_time").toString()).format(API_TIME));
        result.put("nightEndTime", row == null || row.get("night_end_time") == null
                ? null : LocalTime.parse(row.get("night_end_time").toString()).format(API_TIME));
        return result;
    }

    private static LocalTime time(Map<String, Object> body, String key) {
        String value = Json.nullableText(body, key);
        try {
            return value == null ? null : LocalTime.parse(value);
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(400, "INVALID_QUIET_TIME");
        }
    }
}

package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
class SettingsService {

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
        store.update("INSERT INTO settings(user_id,version,notification_enabled,sound_enabled,night_mode_enabled,"
                + "night_start_time,night_end_time) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
                + "version=EXCLUDED.version,notification_enabled=EXCLUDED.notification_enabled,"
                + "sound_enabled=EXCLUDED.sound_enabled,night_mode_enabled=EXCLUDED.night_mode_enabled,"
                + "night_start_time=EXCLUDED.night_start_time,night_end_time=EXCLUDED.night_end_time"
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
                ? null : row.get("night_start_time").toString());
        result.put("nightEndTime", row == null || row.get("night_end_time") == null
                ? null : row.get("night_end_time").toString());
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

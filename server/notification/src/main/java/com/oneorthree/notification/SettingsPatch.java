package com.oneorthree.notification;

import java.time.LocalTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 공개 DTO와 분리된 내부 설정 명령. 누락과 명시 null을 끝까지 구분한다. */
record SettingsPatch(Map<String, Object> values, Long generation, Map<String, Object> baseline) {

    static final Map<String, String> COLUMNS = Map.of(
            "notificationEnabled", "notification_enabled", "soundEnabled", "sound_enabled",
            "nightModeEnabled", "night_mode_enabled", "nightStartTime", "night_start_time",
            "nightEndTime", "night_end_time");
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    SettingsPatch {
        values = Collections.unmodifiableMap(new LinkedHashMap<>(values));
        baseline = Collections.unmodifiableMap(new LinkedHashMap<>(baseline));
    }

    static SettingsPatch partial(Map<String, Object> body) {
        if (!body.keySet().equals(Set.of("mask", "patch", "authGeneration", "baseline"))
                || !(body.get("mask") instanceof List<?> mask) || mask.isEmpty()
                || !(body.get("patch") instanceof Map<?, ?> patch)
                || mask.stream().distinct().count() != mask.size()
                || !mask.stream().allMatch(item -> item instanceof String field && COLUMNS.containsKey(field))
                || !patch.keySet().equals(Set.copyOf(mask))) {
            throw new NotificationFailure(400, "INVALID_SETTINGS_PATCH");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        patch.forEach((key, value) -> values.put(key.toString(), value(key.toString(), value)));
        if (!(body.get("baseline") instanceof Map<?, ?> baseline)
                || !baseline.keySet().equals(COLUMNS.keySet())) {
            throw new NotificationFailure(400, "INVALID_SETTINGS_BASELINE");
        }
        Map<String, Object> initial = full(Json.map(baseline)).values();
        if (values.entrySet().stream().anyMatch(entry -> !java.util.Objects.equals(
                entry.getValue(), initial.get(entry.getKey())))) {
            throw new NotificationFailure(400, "INVALID_SETTINGS_BASELINE");
        }
        return new SettingsPatch(values, number(body.get("authGeneration"), "INVALID_AUTH_GENERATION"), initial);
    }

    static SettingsPatch full(Map<String, Object> body) {
        if (!body.keySet().containsAll(COLUMNS.keySet())) {
            throw new NotificationFailure(400, "FULL_SETTINGS_REQUIRED");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        COLUMNS.keySet().forEach(key -> values.put(key, value(key, body.get(key))));
        Long generation = body.get("authGeneration") == null ? null
                : number(body.get("authGeneration"), "INVALID_AUTH_GENERATION");
        return new SettingsPatch(values, generation, values);
    }

    static long number(Object value, String code) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            throw new NotificationFailure(400, code);
        }
        long number = ((Number) value).longValue();
        if (number < 0 || number > MAX_SAFE_INTEGER) {
            throw new NotificationFailure(400, code);
        }
        return number;
    }

    static void requireVersion(long version) {
        if (version < 1 || version > MAX_SAFE_INTEGER) {
            throw new NotificationFailure(400, "INVALID_SETTINGS_VERSION");
        }
    }

    private static Object value(String key, Object value) {
        if (key.endsWith("Enabled")) {
            if (!(value instanceof Boolean)) {
                throw new NotificationFailure(400, "INVALID_" + key);
            }
            return value;
        }
        if (value == null) {
            return null;
        }
        try {
            if (!(value instanceof String text)) {
                throw new IllegalArgumentException();
            }
            return LocalTime.parse(text);
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(400, "INVALID_QUIET_TIME");
        }
    }
}

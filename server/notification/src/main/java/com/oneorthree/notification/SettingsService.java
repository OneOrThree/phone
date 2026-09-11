package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        SettingsPatch patch = SettingsPatch.full(body);
        SettingsPatch.requireVersion(version);
        return store.command("settings:" + user, key, Map.of("body", body, "version", version), () -> {
            merge(user, patch, version, false, false);
            return Map.of("applied", true);
        }, false, () -> requireLive(user, patch.generation(), false));
    }

    @Transactional
    public Map<String, Object> patch(UUID user, Map<String, Object> body, long version, String key) {
        SettingsPatch patch = SettingsPatch.partial(body);
        SettingsPatch.requireVersion(version);
        return store.command("settings-patch:" + user, key, Map.of("body", body, "version", version), () -> {
            merge(user, patch, version, true, false);
            return Map.of("applied", true);
        }, false, () -> requireLive(user, patch.generation(), true));
    }

    /** relay는 폐기된 명령을 수락한 no-op으로 끝내 뒤의 사용자 이벤트를 막지 않는다. */
    void applyLocked(UUID user, Map<String, Object> body, long version) {
        boolean partial = body.containsKey("mask") || body.containsKey("patch");
        SettingsPatch patch = partial ? SettingsPatch.partial(body) : SettingsPatch.full(body);
        SettingsPatch.requireVersion(version);
        merge(user, patch, version, partial, true);
    }

    /** 이관 완료 뒤 검증된 Data snapshot으로 없는 행만 초기화하고 항상 현재 정본을 읽는다. */
    @Transactional
    public Map<String, Object> initialize(UUID user, Map<String, Object> body) {
        if (!body.keySet().equals(Set.of("version", "authGeneration", "settings"))
                || !(body.get("settings") instanceof Map<?, ?>)) {
            throw new NotificationFailure(400, "INVALID_SETTINGS_BASELINE");
        }
        long version = SettingsPatch.number(body.get("version"), "INVALID_SETTINGS_VERSION");
        long generation = SettingsPatch.number(body.get("authGeneration"), "INVALID_AUTH_GENERATION");
        Map<String, Object> baseline = Json.map(body.get("settings"));
        if (!baseline.keySet().equals(SettingsPatch.COLUMNS.keySet())) {
            throw new NotificationFailure(400, "FULL_SETTINGS_REQUIRED");
        }
        SettingsPatch patch = SettingsPatch.full(baseline);
        requireLive(user, generation, true);
        insert(user, patch.values(), version);
        initializeVersions(user);
        return view(requiredRow(user));
    }

    private void merge(UUID user, SettingsPatch patch, long version, boolean partial, boolean relay) {
        boolean opened = lockGate(partial);
        if (!live(user, patch.generation())) {
            if (relay) {
                return;
            }
            throw new NotificationFailure(409, "STALE_AUTH_GENERATION");
        }
        // 명령 당시 Data mirror의 전체 snapshot이다. 기존 정본이 있으면 절대 덮어쓰지 않는다.
        insert(user, patch.baseline(), version);
        Map<String, Object> row = requiredRow(user);
        if (opened) {
            initializeVersions(user);
            mergeFields(user, patch.values(), version);
        } else if (((Number) row.get("version")).longValue() < version) {
            replaceBeforeMigration(user, patch.values(), version);
        }
    }

    private boolean lockGate(boolean requireOpened) {
        // import/open도 gate -> 실제 사용자 행 순서다. 같은 TX의 공유 잠금으로 초기화 경계를 고정한다.
        Map<String, Object> gate = store.one("SELECT ever_opened FROM dispatch_control WHERE id=1 FOR SHARE");
        if (gate == null || (requireOpened && !Boolean.TRUE.equals(gate.get("ever_opened")))) {
            throw new NotificationFailure(409, "MIGRATION_NOT_READY");
        }
        return Boolean.TRUE.equals(gate.get("ever_opened"));
    }

    private void requireLive(UUID user, Long generation, boolean partial) {
        lockGate(partial);
        if (!live(user, generation)) {
            throw new NotificationFailure(409, "STALE_AUTH_GENERATION");
        }
    }

    private boolean live(UUID user, Long generation) {
        // 탈퇴·같은 사용자 발송과 직렬화하되 다른 사용자의 외부 발송을 기다리지 않는다.
        store.lock("user-state:" + user);
        Map<String, Object> fence = store.one("SELECT auth_generation,withdrawn FROM user_fences WHERE user_id=?",
                user);
        if (fence == null) {
            return true;
        }
        long current = ((Number) fence.get("auth_generation")).longValue();
        // 기존 full PUT은 세대 필드 없는 5값 계약이다. 활성 사용자의 그 호환 경로를 닫지 않는다.
        // 신규 partial/initialize는 파싱 단계에서 세대가 필수이며 탈퇴 tombstone은 양쪽 모두 우선한다.
        return !Boolean.TRUE.equals(fence.get("withdrawn"))
                && (generation == null || generation >= current);
    }

    private void insert(UUID user, Map<String, Object> values, long version) {
        store.update("INSERT INTO settings(user_id,version,notification_enabled,sound_enabled,night_mode_enabled,"
                + "night_start_time,night_end_time) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING",
                user, version, values.get("notificationEnabled"), values.get("soundEnabled"),
                values.get("nightModeEnabled"), values.get("nightStartTime"), values.get("nightEndTime"));
    }

    private void initializeVersions(UUID user) {
        List<String> assignments = new ArrayList<>();
        for (String column : SettingsPatch.COLUMNS.values()) {
            assignments.add(column + "_version=COALESCE(" + column + "_version,version)");
        }
        store.update("UPDATE settings SET " + String.join(",", assignments) + " WHERE user_id=?", user);
    }

    private void mergeFields(UUID user, Map<String, Object> values, long version) {
        for (Map.Entry<String, Object> field : values.entrySet()) {
            String column = SettingsPatch.COLUMNS.get(field.getKey());
            // 컬럼은 고정 허용목록에서만 얻는다. 같은 필드만 단조 비교하고 전체 version은 최댓값이다.
            store.update("UPDATE settings SET " + column + "=?," + column + "_version=?,"
                    + "version=GREATEST(version,?),imported_by=NULL WHERE user_id=? AND "
                    + column + "_version<?", field.getValue(), version, version, user, version);
        }
    }

    private void replaceBeforeMigration(UUID user, Map<String, Object> values, long version) {
        store.update("UPDATE settings SET version=?,notification_enabled=?,sound_enabled=?,night_mode_enabled=?,"
                + "night_start_time=?,night_end_time=?,imported_by=NULL WHERE user_id=?", version,
                values.get("notificationEnabled"), values.get("soundEnabled"), values.get("nightModeEnabled"),
                values.get("nightStartTime"), values.get("nightEndTime"), user);
    }

    private Map<String, Object> requiredRow(UUID user) {
        Map<String, Object> row = store.one("SELECT * FROM settings WHERE user_id=?", user);
        if (row == null) {
            throw new NotificationFailure(409, "SETTINGS_NOT_INITIALIZED");
        }
        return row;
    }

    /** legacy GET의 정상 기본값 계약은 그대로 보존한다. 신규 GET은 initialize를 사용한다. */
    @Transactional(readOnly = true)
    public Map<String, Object> read(UUID user) {
        return view(store.one("SELECT * FROM settings WHERE user_id=?", user));
    }

    private static Map<String, Object> view(Map<String, Object> row) {
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
}

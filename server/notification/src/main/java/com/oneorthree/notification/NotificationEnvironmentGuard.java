package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** 실제 알림 DB와 FCM 프로젝트를 발송 직전까지 확인한다. */
@Component
class NotificationEnvironmentGuard {
    static final class EnvironmentMismatch extends IllegalStateException {
        EnvironmentMismatch(String message) {
            super(message);
        }

        EnvironmentMismatch(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private final Environment environment;
    private final JdbcTemplate jdbc;
    private final String fcmProjectId;

    NotificationEnvironmentGuard(Environment environment, JdbcTemplate jdbc,
            @Value("${fcm.project-id:}") String fcmProjectId) {
        this.environment = environment;
        this.jdbc = jdbc;
        this.fcmProjectId = fcmProjectId;
    }

    boolean isConnectedEnvironment() {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        return profiles.contains("dev") || profiles.contains("prod");
    }

    void assertDispatchReady() {
        identity();
    }

    Map<String, String> identity() {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        boolean dev = profiles.contains("dev");
        boolean prod = profiles.contains("prod");
        if (dev == prod) {
            throw new EnvironmentMismatch("Notification 환경 프로파일이 하나로 결정되지 않았습니다.");
        }
        String expected = dev ? "dev" : "prod";
        List<String> markers;
        List<String> projects;
        String comment = null;
        try {
            markers = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                    + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                    + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                    + " WHERE db.datname=current_database() AND setting.setrole=0"
                    + " AND config LIKE 'gromo.environment=%'", String.class);
            projects = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                    + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                    + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                    + " WHERE db.datname=current_database() AND setting.setrole=0"
                    + " AND config LIKE 'gromo.fcm_project_id=%'", String.class);
            if (markers.isEmpty() && projects.isEmpty()) {
                comment = jdbc.queryForObject("SELECT shobj_description(oid, 'pg_database')"
                        + " FROM pg_database WHERE datname=current_database()", String.class);
            }
        } catch (DataAccessException unavailable) {
            throw new EnvironmentMismatch("Notification DB/FCM 환경 조회에 실패했습니다.", unavailable);
        }
        boolean settingsMatch = markers.size() == 1 && projects.size() == 1
                && expected.equals(markers.get(0)) && fcmProjectId != null && fcmProjectId.equals(projects.get(0));
        boolean commentMatches = markers.isEmpty() && projects.isEmpty() && fcmProjectId != null
                && ("gromo.environment=" + expected + ";gromo.fcm_project_id=" + fcmProjectId).equals(comment);
        if (!settingsMatch && !commentMatches) {
            throw new EnvironmentMismatch("Notification DB/FCM 환경을 확인할 수 없습니다.");
        }
        return Map.of("environment", expected, "fcmProjectId", fcmProjectId);
    }

    /** 배포 커밋 SHA(OBS_VERSION)와 마지막 성공 Flyway 버전. 알 수 없으면 unknown. */
    Map<String, String> versions() {
        String server = environment.getProperty("OBS_VERSION");
        String schema = "unknown";
        try {
            if (Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT to_regclass('flyway_schema_history') IS NOT NULL", Boolean.class))) {
                var rows = jdbc.queryForList("SELECT version FROM flyway_schema_history"
                        + " WHERE success AND version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1", String.class);
                if (!rows.isEmpty() && rows.get(0) != null) {
                    schema = rows.get(0);
                }
            }
        } catch (DataAccessException unavailable) {
            // 이력 조회 실패가 환경 확인 전체를 막지 않는다 — 스키마 버전만 unknown.
        }
        return Map.of("serverVersion", server == null || server.isBlank() ? "unknown" : server.strip(),
                "schemaVersion", schema);
    }
}

package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Map;

/** 실제 알림 DB와 FCM 프로젝트를 발송 직전까지 확인한다. */
@Component
class NotificationEnvironmentGuard {
    static final class EnvironmentMismatch extends IllegalStateException {
        EnvironmentMismatch(String message) {
            super(message);
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
        var markers = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                + " WHERE db.datname=current_database() AND setting.setrole=0"
                + " AND config LIKE 'gromo.environment=%'", String.class);
        var projects = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                + " WHERE db.datname=current_database() AND setting.setrole=0"
                + " AND config LIKE 'gromo.fcm_project_id=%'", String.class);
        if (markers.size() != 1 || !expected.equals(markers.get(0)) || projects.size() != 1
                || fcmProjectId == null || !fcmProjectId.equals(projects.get(0))) {
            throw new EnvironmentMismatch("Notification DB/FCM 환경을 확인할 수 없습니다.");
        }
        return Map.of("environment", expected, "fcmProjectId", fcmProjectId);
    }
}

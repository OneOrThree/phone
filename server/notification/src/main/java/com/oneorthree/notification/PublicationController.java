package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.env.Environment;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;
import java.util.Arrays;

/** 승인된 문구와 명시적 수신자만 공통 발송 큐에 적재한다. */
@RestController
class PublicationController {
    private final PublicationService publications;
    private final Environment environment;
    private final JdbcTemplate jdbc;
    private final String fcmProjectId;

    PublicationController(PublicationService publications, Environment environment, JdbcTemplate jdbc,
            @Value("${fcm.project-id:}") String fcmProjectId) {
        this.publications = publications;
        this.environment = environment;
        this.jdbc = jdbc;
        this.fcmProjectId = fcmProjectId;
    }

    @GetMapping("/internal/admin/publications/environment")
    Map<String, String> environment() {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        boolean dev = profiles.contains("dev");
        boolean prod = profiles.contains("prod");
        if (dev == prod) {
            throw new IllegalStateException("Notification 환경 프로파일이 하나로 결정되지 않았습니다.");
        }
        String expected = dev ? "dev" : "prod";
        var markers = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                + " WHERE db.datname=current_database() AND setting.setrole=0"
                + " AND config LIKE 'gromo.environment=%'", String.class);
        if (markers.size() != 1 || !expected.equals(markers.get(0)) || fcmProjectId == null
                || fcmProjectId.isBlank()) {
            throw new IllegalStateException("Notification DB/FCM 환경을 확인할 수 없습니다.");
        }
        return Map.of("environment", expected, "fcmProjectId", fcmProjectId);
    }

    @PostMapping("/internal/admin/publications/{publicationId}")
    Map<String, Object> publish(@PathVariable UUID publicationId, @RequestBody Map<String, Object> body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        if (profiles.contains("dev") || profiles.contains("prod")) {
            var actual = environment();
            if (request == null || !actual.get("environment").equals(request.getHeader("X-Backoffice-Environment"))
                    || !actual.get("fcmProjectId").equals(request.getHeader("X-Backoffice-Fcm-Project"))) {
                throw new IllegalStateException("백오피스 요청 환경과 Notification DB/FCM 환경이 다릅니다.");
            }
        }
        return publications.publish(AdminAudit.actor(request), publicationId, body, key);
    }
}

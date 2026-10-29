package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.env.Environment;
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

    PublicationController(PublicationService publications, Environment environment) {
        this.publications = publications;
        this.environment = environment;
    }

    @GetMapping("/internal/admin/publications/environment")
    Map<String, String> environment() {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        boolean dev = profiles.contains("dev");
        boolean prod = profiles.contains("prod");
        if (dev == prod) {
            throw new IllegalStateException("Notification 환경 프로파일이 하나로 결정되지 않았습니다.");
        }
        return Map.of("environment", dev ? "dev" : "prod");
    }

    @PostMapping("/internal/admin/publications/{publicationId}")
    Map<String, Object> publish(@PathVariable UUID publicationId, @RequestBody Map<String, Object> body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return publications.publish(AdminAudit.actor(request), publicationId, body, key);
    }
}

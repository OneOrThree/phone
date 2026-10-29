package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/** 승인된 문구와 명시적 수신자만 공통 발송 큐에 적재한다. */
@RestController
class PublicationController {
    private final PublicationService publications;
    private final NotificationEnvironmentGuard guard;
    private final AdminCatalog catalog;

    PublicationController(PublicationService publications, NotificationEnvironmentGuard guard, AdminCatalog catalog) {
        this.publications = publications;
        this.guard = guard;
        this.catalog = catalog;
    }

    @GetMapping("/internal/admin/publications/environment")
    Map<String, String> environment() {
        return guard.identity();
    }

    @GetMapping("/internal/admin/publications/history")
    Map<String, Object> history(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        requireEnvironment(request);
        return catalog.deliveries(AdminAudit.actor(request), cursor, limit, null, null, null);
    }

    @PostMapping("/internal/admin/publications/{publicationId}")
    Map<String, Object> publish(@PathVariable UUID publicationId, @RequestBody Map<String, Object> body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        if (guard.isConnectedEnvironment()) {
            requireEnvironment(request);
        }
        return publications.publish(AdminAudit.actor(request), publicationId, body, key);
    }

    private void requireEnvironment(HttpServletRequest request) {
        var actual = environment();
        if (request == null || !actual.get("environment").equals(request.getHeader("X-Backoffice-Environment"))
                || !actual.get("fcmProjectId").equals(request.getHeader("X-Backoffice-Fcm-Project"))) {
            throw new IllegalStateException("백오피스 요청 환경과 Notification DB/FCM 환경이 다릅니다.");
        }
    }
}

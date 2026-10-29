package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/** 승인된 문구와 명시적 수신자만 공통 발송 큐에 적재한다. */
@RestController
class PublicationController {
    private final PublicationService publications;

    PublicationController(PublicationService publications) {
        this.publications = publications;
    }

    @PostMapping("/internal/admin/publications/{publicationId}")
    Map<String, Object> publish(@PathVariable UUID publicationId, @RequestBody Map<String, Object> body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return publications.publish(AdminAudit.actor(request), publicationId, body, key);
    }
}

package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 이관 표면. 콘솔 토큰으로만 닿는다(ServiceAuth 는 /internal/admin/** 을 console 에게만 연다). */
@RestController
class MigrationController {

    private final MigrationService migration;

    MigrationController(MigrationService migration) {
        this.migration = migration;
    }

    @GetMapping("/internal/admin/migration/{migrationId}")
    Map<String, Object> state(@PathVariable String migrationId, HttpServletRequest request) {
        return migration.state(AdminAudit.actor(request), migrationId);
    }

    @PostMapping("/internal/admin/migration/{migrationId}/import")
    Map<String, Object> importRecords(@PathVariable String migrationId, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        return migration.importRecords(AdminAudit.actor(request), migrationId, body, key);
    }

    /** 검증 실패는 200 이 아니라 422 로 돌려준다. 스크립트가 「통과」로 접지 못하게 한다. */
    @PostMapping("/internal/admin/migration/{migrationId}/verify")
    ResponseEntity<Map<String, Object>> verify(@PathVariable String migrationId,
            @RequestBody Map<String, Object> body, HttpServletRequest request) {
        Map<String, Object> report = migration.verify(AdminAudit.actor(request), migrationId, body);
        return ResponseEntity.status(Boolean.TRUE.equals(report.get("verified")) ? 200 : 422).body(report);
    }

    @PostMapping("/internal/admin/migration/{migrationId}/dispatch/open")
    Map<String, Object> open(@PathVariable String migrationId, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        String actor = AdminAudit.actor(request);
        try {
            return migration.open(actor, migrationId, body, key);
        } catch (NotificationFailure failure) {
            // 개방 트랜잭션이 되감긴 뒤에 지운다. 실패한 개방 다음에 «검증 통과» 표시가 남아 있으면 안 된다.
            if ("VERIFICATION_FAILED".equals(failure.getMessage())) {
                migration.invalidate(actor, migrationId);
            }
            throw failure;
        }
    }

    @PostMapping("/internal/admin/dispatch/close")
    Map<String, Object> close(@RequestHeader(value = "Idempotency-Key", required = false) String key,
            HttpServletRequest request) {
        return migration.close(AdminAudit.actor(request), key);
    }

    @PostMapping("/internal/admin/jobs/{jobId}/replay")
    Map<String, Object> replay(@PathVariable String jobId, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        return migration.replay(AdminAudit.actor(request), jobId, body, key);
    }
}

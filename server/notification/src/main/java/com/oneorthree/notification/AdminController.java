package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/** 콘솔 표면. Bearer 는 ServiceAuth 가, 행위자(X-Console-Actor)는 AdminAudit 이 판별한다. */
@RestController
class AdminController {

    private final AdminCatalog catalog;
    private final AdminService admin;

    AdminController(AdminCatalog catalog, AdminService admin) {
        this.catalog = catalog;
        this.admin = admin;
    }

    @GetMapping("/internal/admin/jobs")
    Map<String, Object> jobs(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        return catalog.jobs(AdminAudit.actor(request), cursor, limit);
    }

    @GetMapping("/internal/admin/templates")
    Map<String, Object> templates(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        return catalog.templates(AdminAudit.actor(request), cursor, limit);
    }

    @GetMapping("/internal/admin/deeplinks")
    Map<String, Object> deeplinks(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        return catalog.deeplinks(AdminAudit.actor(request), cursor, limit);
    }

    @GetMapping("/internal/admin/deliveries")
    Map<String, Object> deliveries(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind, @RequestParam(required = false) String userId,
            HttpServletRequest request) {
        return catalog.deliveries(AdminAudit.actor(request), cursor, limit, status, kind, userId);
    }

    /** 자원 이름은 경로에서 한 번만 받고 AdminCatalog 의 허용목록 switch 가 해석한다. */
    @PutMapping("/internal/admin/{resource}/{id}")
    Map<String, Object> put(@PathVariable String resource, @PathVariable String id,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        return catalog.put(AdminAudit.actor(request), resource, id, body, key);
    }

    @PostMapping("/internal/admin/templates/{id}/preview")
    Map<String, Object> preview(@PathVariable String id, @RequestBody Map<String, Object> body,
            HttpServletRequest request) {
        return admin.preview(AdminAudit.actor(request), id, body);
    }

    @PostMapping("/internal/admin/templates/{id}/test")
    Map<String, Object> test(@PathVariable String id, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        return admin.test(AdminAudit.actor(request), id, body, key);
    }

    @PostMapping("/internal/admin/deliveries/{id}/resend")
    Map<String, Object> resend(@PathVariable UUID id,
            @RequestHeader(value = "Idempotency-Key", required = false) String key, HttpServletRequest request) {
        return admin.resend(AdminAudit.actor(request), id, key);
    }
}

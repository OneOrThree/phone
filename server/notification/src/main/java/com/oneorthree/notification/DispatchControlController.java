package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 콘솔 자격으로 발송을 제어한다. 데이터 반입 경로는 제공하지 않는다. */
@RestController
class DispatchControlController {
    private final DispatchControlService control;

    DispatchControlController(DispatchControlService control) {
        this.control = control;
    }

    @GetMapping("/internal/admin/dispatch")
    Map<String, Object> state(HttpServletRequest request) {
        return control.state(AdminAudit.actor(request));
    }

    @PostMapping("/internal/admin/dispatch/open")
    Map<String, Object> open(@RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return control.open(AdminAudit.actor(request), key);
    }

    @PostMapping("/internal/admin/dispatch/close")
    Map<String, Object> close(@RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return control.close(AdminAudit.actor(request), key);
    }

    @PostMapping("/internal/admin/jobs/{jobId}/replay")
    Map<String, Object> replay(@PathVariable String jobId, @RequestBody Map<String, Object> body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return control.replay(AdminAudit.actor(request), jobId, body, key);
    }
}

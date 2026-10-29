package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.FocusPolicyAdminService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.http.HttpStatus;

import java.util.Arrays;
import java.util.UUID;

/** 관리 토큰의 실제 actor와 요청 환경을 검증한 뒤 정책 이력·발행만 노출한다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/internal/admin/policies/focus")
public class InternalFocusPolicyAdminController {
    private final FocusPolicyAdminService policies;
    private final Environment environment;
    private final JdbcTemplate jdbc;

    @GetMapping
    public FocusPolicyAdminService.View current(HttpServletRequest request) {
        requireEnvironment(request);
        return policies.get();
    }

    @PutMapping("/publications/{publicationId}")
    public FocusPolicyAdminService.Publication publish(@PathVariable UUID publicationId,
            @RequestBody FocusPolicyAdminService.PublishRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return policies.publish(publicationId, body, (String) request.getAttribute("content.actor"));
    }

    @PostMapping("/approvals/{approvalId}")
    public FocusPolicyAdminService.Approval approve(@PathVariable UUID approvalId,
            @RequestBody FocusPolicyAdminService.ApproveRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return policies.approve(approvalId, body, (String) request.getAttribute("content.actor"));
    }

    @DeleteMapping("/approvals/{approvalId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable UUID approvalId, HttpServletRequest request) {
        requireEnvironment(request);
        policies.revoke(approvalId, (String) request.getAttribute("content.actor"));
    }

    private void requireEnvironment(HttpServletRequest request) {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        if (profiles.contains("dev") || profiles.contains("prod")) {
            boolean dev = profiles.contains("dev");
            boolean prod = profiles.contains("prod");
            if (dev == prod) {
                throw new IllegalStateException("Data 환경 프로파일이 하나로 결정되지 않았습니다.");
            }
            String expected = dev ? "dev" : "prod";
            if (!DatabaseEnvironmentMarker.matches(jdbc, expected)
                    || request == null || !expected.equals(request.getHeader("X-Backoffice-Environment"))) {
                throw new IllegalStateException("백오피스 요청 환경과 Data DB 환경이 다릅니다.");
            }
        }
    }
}

package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.CustomizationGrantAdminService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/** 관리 토큰의 실제 actor와 요청 환경을 검증한 뒤 꾸미기 지급(미리 계산·승인·실행)만 노출한다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/internal/admin/customization/grants")
public class InternalCustomizationGrantAdminController {
    private final CustomizationGrantAdminService grants;
    private final Environment environment;
    private final JdbcTemplate jdbc;

    @PostMapping("/previews")
    public CustomizationGrantAdminService.Preview preview(
            @RequestBody CustomizationGrantAdminService.PreviewRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return grants.preview(body);
    }

    @PostMapping("/approvals/{approvalId}")
    public CustomizationGrantAdminService.Approval approve(@PathVariable UUID approvalId,
            @RequestBody CustomizationGrantAdminService.ApproveRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return grants.approve(approvalId, body, (String) request.getAttribute("content.actor"));
    }

    @DeleteMapping("/approvals/{approvalId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable UUID approvalId, HttpServletRequest request) {
        requireEnvironment(request);
        grants.revoke(approvalId, (String) request.getAttribute("content.actor"));
    }

    @PutMapping("/executions/{grantId}")
    public CustomizationGrantAdminService.Execution execute(@PathVariable UUID grantId,
            @RequestBody CustomizationGrantAdminService.ExecuteRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return grants.execute(grantId, body, (String) request.getAttribute("content.actor"));
    }

    @GetMapping("/executions")
    public List<CustomizationGrantAdminService.Execution> executions(
            @RequestParam(defaultValue = "50") int limit, HttpServletRequest request) {
        requireEnvironment(request);
        return grants.recent(limit);
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

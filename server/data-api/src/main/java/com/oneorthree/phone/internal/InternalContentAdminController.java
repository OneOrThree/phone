package com.oneorthree.phone.internal;

import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.internal.dto.ContentHistoryPage;
import com.oneorthree.phone.internal.service.ContentHistoryService;
import com.oneorthree.phone.internal.service.MagazineReviewService;
import com.oneorthree.phone.internal.service.ConstructionPolicyAdminService;
import com.oneorthree.phone.internal.dto.ConstructionPolicyView;
import com.oneorthree.phone.internal.dto.ConstructionPolicyRequest;
import com.oneorthree.phone.internal.dto.ConstructionPolicyApplied;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.UUID;
import java.util.Map;
import java.util.Arrays;

/** 관리 전용 서비스 자격은 InternalAuthFilter에서 행위자와 경로를 함께 제한한다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/internal/admin/content")
public class InternalContentAdminController {
    private final DeveloperNoticeService notices;
    private final ContentHistoryService history;
    private final MagazineReviewService magazine;
    private final ConstructionPolicyAdminService constructionPolicy;
    private final Environment environment;
    private final JdbcTemplate jdbc;

    @GetMapping("/environment")
    public Map<String, Object> environment() {
        return Map.of("environment", verifiedEnvironment(), "contractVersion", "1",
                "capabilities", java.util.List.of("content.publication.v1", "content.history.v1",
                        "construction.policy.v1", "focus.policy.v1"));
    }

    private String verifiedEnvironment() {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        boolean dev = profiles.contains("dev");
        boolean prod = profiles.contains("prod");
        if (dev == prod) {
            throw new IllegalStateException("Data 환경 프로파일이 하나로 결정되지 않았습니다.");
        }
        String expected = dev ? "dev" : "prod";
        if (!DatabaseEnvironmentMarker.matches(jdbc, expected)) {
            throw new IllegalStateException("Data DB 환경이 실행 프로파일과 일치하지 않습니다.");
        }
        return expected;
    }

    @GetMapping("/notices")
    public DeveloperNoticeService.Page notices(HttpServletRequest request) {
        requireEnvironment(request);
        return notices.list(true);
    }

    @GetMapping("/history/notices")
    public ContentHistoryPage noticeHistory(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        requireEnvironment(request);
        return history.notices(cursor, limit);
    }

    @GetMapping("/history/magazines")
    public ContentHistoryPage magazineHistory(@RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        requireEnvironment(request);
        return history.magazines(cursor, limit);
    }

    @PutMapping("/notices/{publicationId}")
    public DeveloperNoticeService.Notice publishNotice(@PathVariable UUID publicationId,
            @RequestBody DeveloperNoticeService.Draft body, HttpServletRequest request) {
        requireEnvironment(request);
        return notices.publish(publicationId, body, actor(request));
    }

    @PostMapping("/magazine/previews")
    public MagazineReviewService.Preview preview(@RequestBody MagazineReviewService.PreviewRequest body,
            HttpServletRequest request) {
        requireEnvironment(request);
        return magazine.preview(body, actor(request));
    }

    @PostMapping("/magazine/publications/{publicationId}")
    public MagazineReviewService.Published publishMagazine(@PathVariable UUID publicationId,
            @RequestBody MagazineReviewService.PublishRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return magazine.publish(publicationId, body, actor(request));
    }

    @GetMapping("/construction-policy")
    public ConstructionPolicyView constructionPolicy(HttpServletRequest request) {
        requireEnvironment(request);
        return constructionPolicy.current();
    }

    @PutMapping("/construction-policy/{publicationId}")
    public ConstructionPolicyApplied applyConstructionPolicy(@PathVariable UUID publicationId,
            @RequestBody ConstructionPolicyRequest body, HttpServletRequest request) {
        requireEnvironment(request);
        return constructionPolicy.apply(publicationId, body, actor(request));
    }

    private void requireEnvironment(HttpServletRequest request) {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        if (profiles.contains("dev") || profiles.contains("prod")) {
            String actual = verifiedEnvironment();
            if (request == null || !actual.equals(request.getHeader("X-Backoffice-Environment"))) {
                throw new IllegalStateException("백오피스 요청 환경과 Data DB 환경이 다릅니다.");
            }
        }
    }

    private String actor(HttpServletRequest request) {
        return (String) request.getAttribute("content.actor");
    }
}

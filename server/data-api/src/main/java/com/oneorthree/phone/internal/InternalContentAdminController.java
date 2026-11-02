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
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
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
import java.util.concurrent.atomic.AtomicBoolean;

/** 관리 전용 서비스 자격은 InternalAuthFilter에서 행위자와 경로를 함께 제한한다. */
@Slf4j
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
    /** Flyway 이력 조회 실패 WARN 을 프로세스당 한 번만 남기는 표식 — 환경 확인이 반복돼도 로그가 쌓이지 않게 한다. */
    private final AtomicBoolean schemaVersionFailureLogged = new AtomicBoolean();

    @GetMapping("/environment")
    public Map<String, Object> environment() {
        return Map.of("environment", verifiedEnvironment(), "contractVersion", "1",
                "serverVersion", serverVersion(), "schemaVersion", schemaVersion(),
                "capabilities", java.util.List.of("content.publication.v1", "content.history.v1",
                        "content.notice.withdraw.v1", "content.app-requirements.v1",
                        "construction.policy.v1", "focus.policy.v1"));
    }

    /** 배포 커밋 SHA(OBS_VERSION). 없으면 unknown. */
    private String serverVersion() {
        String version = environment.getProperty("OBS_VERSION");
        return version == null || version.isBlank() ? "unknown" : version.strip();
    }

    /**
     * 마지막으로 성공 적용된 Flyway 버전. 이력 테이블이나 행이 없거나 조회가 실패하면 unknown(환경 확인을 막지 않는다).
     * 조회 실패는 프로세스당 WARN 한 번만 남긴다.
     */
    private String schemaVersion() {
        try {
            if (!Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT to_regclass('flyway_schema_history') IS NOT NULL", Boolean.class))) {
                return "unknown";
            }
            var versions = jdbc.queryForList("SELECT version FROM flyway_schema_history"
                    + " WHERE success AND version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1", String.class);
            return versions.isEmpty() || versions.get(0) == null ? "unknown" : versions.get(0);
        } catch (DataAccessException e) {
            if (schemaVersionFailureLogged.compareAndSet(false, true)) {
                log.warn("Flyway 이력 조회 실패 — schemaVersion 을 unknown 으로 응답한다(이후 실패는 로그하지 않는다)", e);
            }
            return "unknown";
        }
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

    @PostMapping("/notices/{publicationId}/withdraw")
    public DeveloperNoticeService.Withdrawal withdrawNotice(@PathVariable UUID publicationId,
            HttpServletRequest request) {
        requireEnvironment(request);
        return notices.withdraw(publicationId, actor(request));
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

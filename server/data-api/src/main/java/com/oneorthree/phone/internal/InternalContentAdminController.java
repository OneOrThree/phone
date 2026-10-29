package com.oneorthree.phone.internal;

import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.content.service.ContentHistoryService;
import com.oneorthree.phone.internal.service.MagazineReviewService;
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
    private final Environment environment;
    private final JdbcTemplate jdbc;

    @GetMapping("/environment")
    public Map<String, String> environment() {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        boolean dev = profiles.contains("dev");
        boolean prod = profiles.contains("prod");
        if (dev == prod) {
            throw new IllegalStateException("Data 환경 프로파일이 하나로 결정되지 않았습니다.");
        }
        String expected = dev ? "dev" : "prod";
        var markers = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                + " WHERE db.datname=current_database() AND setting.setrole=0"
                + " AND config LIKE 'gromo.environment=%'", String.class);
        if (markers.size() != 1 || !expected.equals(markers.get(0))) {
            throw new IllegalStateException("Data DB 환경이 실행 프로파일과 일치하지 않습니다.");
        }
        return Map.of("environment", expected);
    }

    @GetMapping("/notices")
    public DeveloperNoticeService.Page notices(HttpServletRequest request) {
        requireEnvironment(request);
        return notices.list(true);
    }

    @GetMapping("/history/notices")
    public ContentHistoryService.Page noticeHistory(@RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        requireEnvironment(request);
        return history.notices(offset, limit);
    }

    @GetMapping("/history/magazines")
    public ContentHistoryService.Page magazineHistory(@RequestParam(required = false) Integer offset,
            @RequestParam(required = false) Integer limit, HttpServletRequest request) {
        requireEnvironment(request);
        return history.magazines(offset, limit);
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

    private void requireEnvironment(HttpServletRequest request) {
        var profiles = Arrays.asList(environment.getActiveProfiles());
        if (profiles.contains("dev") || profiles.contains("prod")) {
            String actual = environment().get("environment");
            if (request == null || !actual.equals(request.getHeader("X-Backoffice-Environment"))) {
                throw new IllegalStateException("백오피스 요청 환경과 Data DB 환경이 다릅니다.");
            }
        }
    }

    private String actor(HttpServletRequest request) {
        return (String) request.getAttribute("content.actor");
    }
}

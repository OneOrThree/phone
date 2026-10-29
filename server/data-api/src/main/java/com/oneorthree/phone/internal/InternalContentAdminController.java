package com.oneorthree.phone.internal;

import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.internal.service.MagazineReviewService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 관리 전용 서비스 자격은 InternalAuthFilter에서 행위자와 경로를 함께 제한한다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/internal/admin/content")
public class InternalContentAdminController {
    private final DeveloperNoticeService notices;
    private final MagazineReviewService magazine;

    @GetMapping("/notices")
    public DeveloperNoticeService.Page notices() {
        return notices.list(true);
    }

    @PutMapping("/notices/{publicationId}")
    public DeveloperNoticeService.Notice publishNotice(@PathVariable UUID publicationId,
            @RequestBody DeveloperNoticeService.Draft body, HttpServletRequest request) {
        return notices.publish(publicationId, body, actor(request));
    }

    @PostMapping("/magazine/previews")
    public MagazineReviewService.Preview preview(@RequestBody MagazineReviewService.PreviewRequest body,
            HttpServletRequest request) {
        return magazine.preview(body, actor(request));
    }

    @PostMapping("/magazine/publications/{publicationId}")
    public MagazineReviewService.Published publishMagazine(@PathVariable UUID publicationId,
            @RequestBody MagazineReviewService.PublishRequest body, HttpServletRequest request) {
        return magazine.publish(publicationId, body, actor(request));
    }

    private String actor(HttpServletRequest request) {
        return (String) request.getAttribute("content.actor");
    }
}

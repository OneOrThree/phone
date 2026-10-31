package com.oneorthree.phone.internal;

import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 활성 사용자(게스트 포함)가 현재 게시 중인 전역 개발자 소식을 읽는다. */
@RestController
@RequiredArgsConstructor
public class InternalDeveloperNoticeController {
    private final DeveloperNoticeService notices;
    private final UserQueryService users;

    @GetMapping("/internal/users/{userId}/developer-notices")
    public DeveloperNoticeService.Page list(@PathVariable UUID userId) {
        users.getCaller(userId);
        return notices.list(false);
    }

    @GetMapping("/internal/users/{userId}/developer-notices/{publicationId}")
    public DeveloperNoticeService.Notice get(@PathVariable UUID userId, @PathVariable UUID publicationId) {
        users.getCaller(userId);
        return notices.get(publicationId);
    }

    /** 사용자 없는 공개 조회용. 현재 유효한 플랫폼 최소 버전. */
    @GetMapping("/internal/developer-notices/app-requirements")
    public DeveloperNoticeService.AppRequirement appRequirements(@RequestParam(required = false) String platform) {
        return notices.appRequirement(platform);
    }
}

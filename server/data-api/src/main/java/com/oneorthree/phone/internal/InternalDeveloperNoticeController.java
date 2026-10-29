package com.oneorthree.phone.internal;

import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 활성 사용자(게스트 포함)가 현재 게시 중인 전역 개발자 소식을 읽는다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/internal/users/{userId}/developer-notices")
public class InternalDeveloperNoticeController {
    private final DeveloperNoticeService notices;
    private final UserQueryService users;

    @GetMapping
    public DeveloperNoticeService.Page list(@PathVariable UUID userId) {
        users.getCaller(userId);
        return notices.list(false);
    }

    @GetMapping("/{publicationId}")
    public DeveloperNoticeService.Notice get(@PathVariable UUID userId, @PathVariable UUID publicationId) {
        users.getCaller(userId);
        return notices.get(publicationId);
    }
}

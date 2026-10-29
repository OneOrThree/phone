package com.oneorthree.business.api;

import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.DeveloperNoticeUseCase;
import com.oneorthree.business.upstream.data.dto.DeveloperNotices;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** 로그인한 사용자와 게스트가 읽는 개발자 전역 소식. 쓰기 경로는 공개하지 않는다. */
@RestController
@RequiredArgsConstructor
public class DeveloperNoticeController {
    private final SettingsSessionGuard sessions;
    private final DeveloperNoticeUseCase notices;
    private final UpstreamConfigProperties properties;

    @GetMapping("/me/developer-notices")
    public DeveloperNotices.Page list(HttpServletRequest request) {
        var claims = sessions.requireSession(request);
        return notices.list(claims.userId(), properties.deadline());
    }

    @GetMapping("/me/developer-notices/{publicationId}")
    public DeveloperNotices.Notice get(@PathVariable String publicationId, HttpServletRequest request) {
        var claims = sessions.requireSession(request);
        return notices.get(claims.userId(), PublicIds.uuid(publicationId, "publicationId"),
                properties.deadline());
    }

}

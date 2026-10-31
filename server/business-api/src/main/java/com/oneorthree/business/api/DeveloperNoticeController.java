package com.oneorthree.business.api;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.DeveloperNoticeUseCase;
import com.oneorthree.business.api.dto.DeveloperNoticeResponses;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
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
    public DeveloperNoticeResponses.Page list(HttpServletRequest request) {
        var claims = sessions.requireSession(request);
        return DeveloperNoticeResponses.Page.from(notices.list(claims.userId(), properties.deadline()));
    }

    /** 로그인 전 앱도 부른다 — 필터가 인증을 건너뛰는 정확 일치 경로이며 세션을 요구하지 않는다. */
    @GetMapping("/auth/sessions/app-requirements")
    public DeveloperNoticeResponses.AppRequirement appRequirements(HttpServletRequest request,
            HttpServletResponse response) {
        // @RequestParam String 은 다중 값을 첫 값으로 접어 통과시키므로 직접 읽는다.
        String[] values = request.getParameterValues("platform");
        if (values == null || values.length != 1 || !("ios".equals(values[0]) || "android".equals(values[0]))) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "platform");
        }
        // ponytail: 호출마다 Data 조회 1회이고 호출 제한이 없다. 공개 호출이 부하로 보이면 유스케이스에 짧은 TTL 캐시를 둔다.
        var result = DeveloperNoticeResponses.AppRequirement.from(
                notices.appRequirement(values[0], properties.deadline()));
        // 성공만 공용 캐시를 허용한다. 실패는 RequestEnvelopeFilter 의 no-store 가 남는다.
        response.setHeader("Cache-Control", "public, max-age=60");
        return result;
    }

    @GetMapping("/me/developer-notices/{publicationId}")
    public DeveloperNoticeResponses.Notice get(@PathVariable String publicationId, HttpServletRequest request) {
        var claims = sessions.requireSession(request);
        return DeveloperNoticeResponses.Notice.from(notices.get(claims.userId(),
                PublicIds.uuid(publicationId, "publicationId"), properties.deadline()));
    }

}

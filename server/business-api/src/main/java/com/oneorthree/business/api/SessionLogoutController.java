package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.SessionLogoutUseCase;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/** 공개 RT-only 로그아웃. 필터 예외와 동일한 raw method/path를 재확인한다. */
@RestController
@RequiredArgsConstructor
public class SessionLogoutController {

    private final SessionLogoutUseCase sessions;
    private final AccessTokenVerifier verifier;
    private final UpstreamConfigProperties properties;

    @DeleteMapping(LogoutCredentials.PATH)
    public SessionLogoutUseCase.Result logout(HttpServletRequest request) throws IOException {
        if (!LogoutCredentials.matches(request) || request.getQueryString() != null
                || request.getContentLengthLong() > 0 || request.getInputStream().read() != -1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        LogoutCredentials credentials = LogoutCredentials.from(request);
        if (credentials.accessToken() != null && verifier.verify(credentials.accessToken()).isEmpty()) {
            throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
        }
        return sessions.logout(credentials, Deadline.startingNow(properties.getComposition().getDeadline()));
    }
}

package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.auth.AuthAttributes;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 서명된 sid/gen 형식만 확인한다. 현재 세션/활성 검증은 Data의 해당 요청 TX가 소유한다. */
@Component
@RequiredArgsConstructor
public class SettingsSessionGuard {

    private final AccessTokenVerifier verifier;

    public AccessTokenClaims requireSession(HttpServletRequest request) {
        Object authenticated = request.getAttribute(AuthAttributes.CLAIMS);
        String authorization = request.getHeader("Authorization");
        if (!(authenticated instanceof AccessTokenClaims) || authorization == null
                || !authorization.startsWith("Bearer ")) {
            throw unauthorized();
        }
        AccessTokenClaims strict = verifier.verifySession(authorization.substring(7)).orElseThrow(this::unauthorized);
        if (!strict.equals(authenticated)) {
            throw unauthorized();
        }
        return strict;
    }

    private PublicApiException unauthorized() {
        return new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
    }
}

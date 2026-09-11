package com.oneorthree.business.auth;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Enumeration;

/** RT-only 로그아웃 자격. 원문은 HTTP 본문에서만 사용하고 문자열 표현에는 남기지 않는다. */
public record LogoutCredentials(String refreshToken, String accessToken) {

    public static final String PATH = "/auth/sessions/current";
    public static final String REFRESH_HEADER = "X-Refresh-Token";
    private static final int MAX_CREDENTIAL_LENGTH = 8192;
    private static final String BEARER = "Bearer ";

    public static boolean matches(HttpServletRequest request) {
        return "DELETE".equals(request.getMethod()) && PATH.equals(request.getRequestURI());
    }

    public static LogoutCredentials from(HttpServletRequest request) {
        String refresh = single(request, REFRESH_HEADER, ApiErrorCode.REFRESH_TOKEN, true);
        String authorization = single(request, "Authorization", ApiErrorCode.UNAUTHORIZED, false);
        String access = null;
        if (authorization != null) {
            if (!authorization.startsWith(BEARER) || authorization.length() == BEARER.length()) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            access = authorization.substring(BEARER.length());
        }
        return new LogoutCredentials(refresh, access);
    }

    private static String single(HttpServletRequest request, String header, ApiErrorCode error, boolean required) {
        Enumeration<String> values = request.getHeaders(header);
        if (values == null || !values.hasMoreElements()) {
            if (required) {
                throw new PublicApiException(error, null);
            }
            return null;
        }
        String value = values.nextElement();
        if (values.hasMoreElements() || value == null || value.isBlank()
                || value.length() > MAX_CREDENTIAL_LENGTH || !value.equals(value.strip()) || value.contains(",")) {
            throw new PublicApiException(error, null);
        }
        return value;
    }

    @Override
    public String toString() {
        return "LogoutCredentials[redacted]";
    }
}

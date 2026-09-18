package com.oneorthree.business.auth;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Enumeration;
import java.util.UUID;

/**
 * 로그인 시도 자격 — {@code X-Login-Attempt-Id} 와 <b>선택</b> AT (계정 LLD §2.1).
 *
 * <p>{@link LogoutCredentials} 와 같은 모양이다: raw method/path 정확 일치를 한 곳에 두고, 필터와
 * 컨트롤러가 <b>같은</b> 판정을 쓴다. 두 곳이 각자 경로를 비교하면 한쪽만 정규화된 값을 보게 되는
 * 순간 필터 예외와 실제 라우팅이 어긋난다.
 *
 * <h2>AT 가 «선택» 이라는 것의 의미</h2>
 * 최초 로그인에는 AT 가 없다 — 그래서 {@code AccessTokenFilter} 가 이 경로를 통과시켜야 한다.
 * 하지만 <b>보냈다면 반드시 유효해야 한다</b>. LLD §2.1 은 「잘못된 AT 를 익명 로그인으로 조용히
 * 강등하지 않는다」고 못 박는다 — 강등하면 폐기된 게스트의 AT 를 들고 온 요청이 새 계정으로
 * 통과하면서, 막으려던 승격 우회가 그대로 열린다.
 */
public record LoginAttemptCredentials(UUID attemptId, String accessToken) {

    public static final String PATH = "/auth/sessions";
    public static final String ATTEMPT_HEADER = "X-Login-Attempt-Id";
    private static final String BEARER = "Bearer ";
    private static final int UUID_LENGTH = 36;
    private static final int MAX_CREDENTIAL_LENGTH = 8192;

    /** 필터 예외와 컨트롤러가 공유하는 정확 일치. {@code getRequestURI()} 는 디코딩 전 원문이다. */
    public static boolean matches(HttpServletRequest request) {
        return "POST".equals(request.getMethod()) && PATH.equals(request.getRequestURI());
    }

    public static LoginAttemptCredentials from(HttpServletRequest request) {
        String rawAttemptId = single(request, ATTEMPT_HEADER, ApiErrorCode.INVALID_REQUEST, ATTEMPT_HEADER);
        if (rawAttemptId == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, ATTEMPT_HEADER);
        }
        UUID attemptId = canonicalUuid(rawAttemptId);

        String authorization = single(request, "Authorization", ApiErrorCode.UNAUTHORIZED, null);
        String access = null;
        if (authorization != null) {
            if (!authorization.startsWith(BEARER) || authorization.length() == BEARER.length()) {
                throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
            }
            access = authorization.substring(BEARER.length());
        }
        return new LoginAttemptCredentials(attemptId, access);
    }

    /**
     * 하이픈 포함 36자 UUID 만 받는다.
     *
     * <p>버전 비트는 <b>보지 않는다</b> — 정책 A19 가 「v4/v7 은 생성 «권고»이며 다른 버전이라는
     * 이유로 거부하지 않는다」이다. 거부하면 다른 UUID 구현을 쓰는 앱 빌드가 통째로 로그인하지
     * 못한다. 반면 형식은 엄격하다: {@code UUID.fromString} 은 {@code "1-2-3-4-5"} 같은 짧은
     * 문자열도 받아들여, 길이·왕복 검사를 하지 않으면 같은 시도가 두 표기로 갈린다.
     */
    private static UUID canonicalUuid(String value) {
        if (value.length() != UUID_LENGTH) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, ATTEMPT_HEADER);
        }
        try {
            UUID parsed = UUID.fromString(value);
            if (!parsed.toString().equalsIgnoreCase(value)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, ATTEMPT_HEADER);
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, ATTEMPT_HEADER);
        }
    }

    /**
     * 헤더가 <b>정확히 하나</b>여야 한다.
     *
     * <p>둘을 허용하면 프록시 단계마다 다른 값을 고를 수 있고, 그러면 「같은 시도인가」 판정이
     * 경유 경로에 따라 갈린다 — 멱등 계약이 통째로 무의미해진다.
     */
    private static String single(HttpServletRequest request, String header, ApiErrorCode error, String field) {
        Enumeration<String> values = request.getHeaders(header);
        if (values == null || !values.hasMoreElements()) {
            return null;
        }
        String value = values.nextElement();
        if (values.hasMoreElements() || value == null || value.isBlank()
                || value.length() > MAX_CREDENTIAL_LENGTH || !value.equals(value.strip())
                || value.contains(",")) {
            throw new PublicApiException(error, field);
        }
        return value;
    }

    /** AT 원문이 로그·오류 덤프로 새지 않게 한다 (LLD §2.1 「헤더도 자격이다」). */
    @Override
    public String toString() {
        return "LoginAttemptCredentials[attemptId=" + attemptId + ", accessToken=redacted]";
    }
}

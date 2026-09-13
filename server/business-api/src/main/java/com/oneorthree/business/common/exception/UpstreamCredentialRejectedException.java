package com.oneorthree.business.common.exception;

/**
 * 상류가 <b>이 서비스의 서비스 토큰</b>을 거절했다(401/403 + 도메인 코드 없음).
 *
 * <p>요청자의 AT 문제가 아니다 — 앱에 401 을 주면 멀쩡한 세션이 전부 재로그인으로 튄다. 배포·시크릿
 * 배선 사고이므로 502 로 올리고 로그에 caller 대상만 남긴다(토큰 값은 절대 로그에 넣지 않는다, A11).
 */
public class UpstreamCredentialRejectedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public UpstreamCredentialRejectedException(String message) {
        super(message);
    }
}

package com.oneorthree.phone.auth.exception;

import lombok.Getter;

/**
 * 계정 상태로 인한 로그인 거절. {@code GlobalExceptionHandler} 가 잡아 코드에 실린 상태(409·429)와
 * enum 이름을 그대로 응답으로 바꾼다 — 던지는 쪽은 HTTP 를 몰라도 된다.
 */
@Getter
public class AuthException extends RuntimeException {

    /** 응답 상태와 본문 {@code code} 를 함께 결정하는 값 — 핸들러가 이 하나만 보고 응답을 만든다. */
    private final AuthErrorCode errorCode;

    /**
     * @param errorCode 거절 사유. 메시지는 여기서 꺼내 오므로 별도로 넘기지 않는다 —
     *                  사용자에게 보일 문구가 코드 옆에 모여 있어야 표현이 갈라지지 않는다
     */
    public AuthException(AuthErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

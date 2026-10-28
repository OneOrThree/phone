package com.oneorthree.phone.common.exception;

import lombok.Getter;

/**
 * API 에러 응답의 공통 봉투 — {@code GlobalExceptionHandler} 가 모든 예외를 이 형태로 바꿔 내보낸다.
 *
 * <p>앱이 {@code code} 로 분기하므로 <b>필드 이름과 code 값은 계약</b>이다. 값을 늘리는 건 안전하지만
 * 기존 값의 이름을 바꾸면 앱의 분기가 조용히 빠진다. 필드를 더해야 할 땐 이 클래스를 고치지 말고
 * {@link RetryAfterErrorResponse} 처럼 상속해서 additive 하게 늘린다.
 */
@Getter
public class ErrorResponse {

    private final String code;
    private final String message;

    /**
     * @param code 앱이 분기에 쓰는 기계용 식별자. 보통 에러코드 enum 의 이름을 그대로 쓴다
     * @param message 사람이 읽는 설명. 화면에 그대로 노출될 수 있으므로 스택트레이스·SQL·내부 식별자처럼
     *                구현이 드러나는 문자열을 넣지 않는다
     */
    public ErrorResponse(String code, String message) {
        this.code = code;
        this.message = message;
    }
}

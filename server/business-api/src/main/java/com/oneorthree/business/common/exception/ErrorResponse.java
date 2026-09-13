package com.oneorthree.business.common.exception;

import lombok.Getter;

/**
 * API 에러 응답의 공통 봉투 — Data API 의 {@code ErrorResponse} 와 필드가 같다.
 *
 * <p>앱이 {@code code} 로 분기하므로 <b>필드 이름과 code 값은 계약</b>이다. 필드를 더해야 할 땐 이
 * 클래스를 고치지 말고 {@link RetryAfterErrorResponse} 처럼 상속해 additive 하게 늘린다.
 */
@Getter
public class ErrorResponse {

    private final String code;
    private final String message;

    public ErrorResponse(String code, String message) {
        this.code = code;
        this.message = message;
    }
}

package com.oneorthree.phone.appearance.exception;

import com.oneorthree.phone.common.exception.DomainException;

/**
 * 외양 도메인의 단일 예외 — 상태 코드와 문구는 전부 {@link AppearanceErrorCode} 가 들고 있다.
 * 실패 종류가 늘어도 예외 클래스는 늘리지 않고 코드를 늘린다({@code ConstructionException} 과 같은 규칙).
 */
public class AppearanceException extends DomainException {

    private final AppearanceErrorCode errorCode;

    public AppearanceException(AppearanceErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }

    public AppearanceErrorCode getErrorCode() {
        return errorCode;
    }
}

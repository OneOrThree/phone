package com.oneorthree.phone.construction.exception;

import com.oneorthree.phone.common.exception.DomainException;

/**
 * 건설 도메인의 단일 예외 — 상태 코드와 문구는 전부 {@link ConstructionErrorCode} 가 들고 있다.
 * 실패 종류가 늘어도 예외 클래스는 늘리지 않고 코드를 늘린다({@code GroupException} 과 같은 규칙).
 */
public class ConstructionException extends DomainException {

    private final ConstructionErrorCode errorCode;

    public ConstructionException(ConstructionErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }

    public ConstructionErrorCode getErrorCode() {
        return errorCode;
    }
}

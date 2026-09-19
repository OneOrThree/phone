package com.oneorthree.phone.shop.exception;

import com.oneorthree.phone.common.exception.DomainException;

/** 상점 도메인의 단일 예외 — 상태 코드와 문구는 {@link ShopErrorCode} 가 들고 있다. */
public class ShopException extends DomainException {

    private final ShopErrorCode errorCode;

    public ShopException(ShopErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }

    public ShopErrorCode getErrorCode() {
        return errorCode;
    }
}

package com.oneorthree.phone.currency.exception;

import lombok.Getter;

@Getter
public class CurrencyException extends RuntimeException {

    private final CurrencyErrorCode errorCode;

    public CurrencyException(CurrencyErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

package com.oneorthree.phone.currency.exception;

import lombok.Getter;

@Getter
public class CurrencyException extends RuntimeException {

    private final CurrencyErrorCode errorCode;

    public CurrencyException(CurrencyErrorCode errorCode) {
        this.errorCode = errorCode;
    }
}

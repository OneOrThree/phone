package com.oneorthree.phone.exception;

public class CurrencyException extends RuntimeException {
    public CurrencyException(CurrencyErrorCode errorCode) {
        super(errorCode.getMessage());
    }
}

package com.oneorthree.phone.auth.exception;

import lombok.Getter;

@Getter
public class InvalidTokenException extends RuntimeException {

    private final InvalidTokenErrorCode errorCode;

    public InvalidTokenException(InvalidTokenErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

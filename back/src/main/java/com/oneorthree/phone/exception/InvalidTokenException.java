package com.oneorthree.phone.exception;

public class InvalidTokenException extends RuntimeException {
    public InvalidTokenException(InvalidTokenErrorCode errorCode) {
        super(errorCode.getMessage());
    }
}

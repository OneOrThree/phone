package com.oneorthree.phone.focus.exception;

import lombok.Getter;

@Getter
public class FocusException extends RuntimeException {

    private final FocusErrorCode errorCode;

    public FocusException(FocusErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

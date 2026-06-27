package com.oneorthree.phone.social.exception;

public class FriendException extends RuntimeException {
    private final FriendErrorCode errorCode;

    public FriendException(FriendErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public FriendErrorCode getErrorCode() {
        return errorCode;
    }
}

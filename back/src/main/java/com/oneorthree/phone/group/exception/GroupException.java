package com.oneorthree.phone.group.exception;

public class GroupException extends RuntimeException {
    private final GroupErrorCode errorCode;

    public GroupException(GroupErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public GroupErrorCode getErrorCode() {
        return errorCode;
    }
}

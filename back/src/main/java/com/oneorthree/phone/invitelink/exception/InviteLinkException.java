package com.oneorthree.phone.invitelink.exception;

import lombok.Getter;

@Getter
public class InviteLinkException extends RuntimeException {

    private final InviteLinkErrorCode errorCode;

    public InviteLinkException(InviteLinkErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

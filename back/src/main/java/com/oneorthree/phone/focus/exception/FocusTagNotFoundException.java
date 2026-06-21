package com.oneorthree.phone.exception;

public class FocusTagNotFoundException extends RuntimeException {
    public FocusTagNotFoundException() {
        super("존재하지 않는 태그입니다.");
    }
}

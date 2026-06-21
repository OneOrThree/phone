package com.oneorthree.phone.exception;

import lombok.Getter;

@Getter
public enum InvalidTokenErrorCode {
    KAKAO_TOKEN("Invalid Kakao Token"),
    REFRESH_TOKEN("Invalid Refresh Token"),
    APPLE_TOKEN("Invalid Apple Token");

    private final String message;

    InvalidTokenErrorCode(String message) {
        this.message = message;
    }
}

package com.oneorthree.phone.auth.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum InvalidTokenErrorCode {

    KAKAO_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Kakao Token"),
    REFRESH_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Refresh Token"),
    APPLE_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Apple Token"),
    GOOGLE_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Google Token"),
    LINE_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Line Token"),
    INSTAGRAM_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Instagram Token"),
    FACEBOOK_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Facebook Token");

    private final HttpStatus status;
    private final String message;

    InvalidTokenErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

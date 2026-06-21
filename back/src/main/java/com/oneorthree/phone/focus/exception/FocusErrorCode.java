package com.oneorthree.phone.focus.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum FocusErrorCode {

    TAG_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 태그입니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "권한이 없습니다.");

    private final HttpStatus status;
    private final String message;

    FocusErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

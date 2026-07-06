package com.oneorthree.phone.focus.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum FocusErrorCode {

    TAG_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 태그입니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "권한이 없습니다."),
    INVALID_DATE_RANGE(HttpStatus.BAD_REQUEST, "유효하지 않은 기간입니다."),
    INVALID_PAGE_REQUEST(HttpStatus.BAD_REQUEST, "유효하지 않은 페이지 요청입니다."),
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 집중 세션입니다."),
    SESSION_ALREADY_ENDED(HttpStatus.CONFLICT, "이미 종료된 집중 세션입니다.");

    private final HttpStatus status;
    private final String message;

    FocusErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

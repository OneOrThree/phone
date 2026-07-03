package com.oneorthree.phone.analytics.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum AnalyticsErrorCode {

    UNSUPPORTED_EVENT(HttpStatus.BAD_REQUEST, "허용되지 않은 이벤트입니다."),
    INVALID_PAYLOAD(HttpStatus.BAD_REQUEST, "payload 형식이 올바르지 않습니다.");

    private final HttpStatus status;
    private final String message;

    AnalyticsErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

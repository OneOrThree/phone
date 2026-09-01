package com.oneorthree.phone.analytics.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 이벤트 수집이 거절되는 사유. 전부 400 계열 — 서버 내부 사정이 아니라
 * 앱이 보낸 요청이 계약을 어긴 경우만 여기에 들어온다.
 */
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

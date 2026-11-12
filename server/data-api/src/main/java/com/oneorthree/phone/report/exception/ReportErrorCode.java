package com.oneorthree.phone.report.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum ReportErrorCode implements ErrorCode {
    REPORT_INVALID(HttpStatus.BAD_REQUEST, "신고 대상과 내용을 확인해 주세요."),
    REPORT_KEY_REUSED(HttpStatus.CONFLICT, "이미 다른 내용으로 접수한 요청이에요."),
    REPORT_NOT_FOUND(HttpStatus.NOT_FOUND, "신고를 찾을 수 없습니다."),
    REPORT_CLOSED(HttpStatus.CONFLICT, "이미 종결한 신고입니다.");

    private final HttpStatus status;
    private final String message;

    ReportErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

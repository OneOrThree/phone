package com.oneorthree.phone.internal.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum ReportDeliveryErrorCode implements ErrorCode {
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "다른 신고에 사용한 요청 키입니다."),
    REQUEST_IN_PROGRESS(HttpStatus.CONFLICT, "신고를 처리 중입니다. 잠시 후 다시 시도해 주세요."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "신고 전달 건을 찾을 수 없습니다."),
    STATE_CONFLICT(HttpStatus.CONFLICT, "신고 전달 상태가 변경되었습니다.");

    private final HttpStatus status;
    private final String message;

    ReportDeliveryErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

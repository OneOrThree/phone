package com.oneorthree.phone.stats.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 통계 도메인의 실패 사유. 각 값이 HTTP 상태와 사용자 노출 문구를 함께 들고 있어, 던지는 쪽이 상태 코드를
 * 고르지 않는다.
 */
@Getter
public enum StatsErrorCode implements ErrorCode {

    INVALID_DATE_RANGE(HttpStatus.BAD_REQUEST, "유효하지 않은 날짜 범위입니다.");

    private final HttpStatus status;
    private final String message;

    StatsErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

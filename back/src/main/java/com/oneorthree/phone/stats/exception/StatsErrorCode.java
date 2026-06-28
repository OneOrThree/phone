package com.oneorthree.phone.stats.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum StatsErrorCode {

    INVALID_DATE_RANGE(HttpStatus.BAD_REQUEST, "유효하지 않은 날짜 범위입니다.");

    private final HttpStatus status;
    private final String message;

    StatsErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

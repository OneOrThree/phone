package com.oneorthree.phone.stats.exception;

import lombok.Getter;

@Getter
public class StatsException extends RuntimeException {

    private final StatsErrorCode errorCode;

    public StatsException(StatsErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

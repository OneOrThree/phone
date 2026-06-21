package com.oneorthree.phone.currency.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum CurrencyErrorCode {

    INSUFFICIENT_CURRENCY(HttpStatus.BAD_REQUEST, "재화가 부족합니다."),
    ILLEGAL_EARN_REASON(HttpStatus.BAD_REQUEST, "적립에 사용할 수 없는 사유입니다."),
    ILLEGAL_SPEND_REASON(HttpStatus.BAD_REQUEST, "사용에 사용할 수 없는 사유입니다.");

    private final HttpStatus status;
    private final String message;

    CurrencyErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}

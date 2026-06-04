package com.oneorthree.phone.exception;

import lombok.Getter;

@Getter
public enum CurrencyErrorCode {
    INSUFFICIENT_CURRENCY("재화가 부족합니다."),
    ILLEGAL_EARN_REASON("적립에 사용할 수 없는 사유입니다."),
    ILLEGAL_SPEND_REASON("사용에 사용할 수 없는 사유입니다.");


    private final String message;

    CurrencyErrorCode(String message) { this.message = message; }
}

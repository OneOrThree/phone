package com.oneorthree.phone.currency.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 재화 변동이 거절되는 사유. 전부 400 — 잔액이 모자라거나 그 경로에서 쓸 수 없는
 * 사유를 실어 보낸 경우이며, 어느 쪽이든 잔액과 원장은 손대지 않은 채로 끝난다.
 */
@Getter
public enum CurrencyErrorCode implements ErrorCode {

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

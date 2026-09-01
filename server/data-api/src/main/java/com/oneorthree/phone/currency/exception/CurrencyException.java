package com.oneorthree.phone.currency.exception;

import lombok.Getter;

/**
 * 재화 변동 거절을 나르는 도메인 예외. 변경 트랜잭션 안에서 던져지므로 이 예외가 나가면
 * 지갑 차감과 원장 기입이 함께 롤백되고, 잔액은 호출 전 상태 그대로 남는다.
 */
@Getter
public class CurrencyException extends RuntimeException {

    /** 응답 status·message 의 출처가 되는 거절 사유. */
    private final CurrencyErrorCode errorCode;

    /**
     * 거절 사유를 담아 예외를 만든다.
     *
     * @param errorCode 거절 사유. 예외 메시지도 이 코드의 message 를 그대로 쓴다
     */
    public CurrencyException(CurrencyErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

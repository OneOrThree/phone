package com.oneorthree.phone.analytics.exception;

import lombok.Getter;

/**
 * 이벤트 수집 거절을 나르는 도메인 예외. 전역 예외 핸들러가 실린 코드의
 * status·message 를 그대로 응답으로 바꾸므로, 던지는 쪽은 사유만 고르면 된다.
 */
@Getter
public class AnalyticsException extends RuntimeException {

    /** 응답 status·message 의 출처가 되는 거절 사유. */
    private final AnalyticsErrorCode errorCode;

    /**
     * 거절 사유를 담아 예외를 만든다.
     *
     * @param errorCode 거절 사유. 예외 메시지도 이 코드의 message 를 그대로 쓴다
     */
    public AnalyticsException(AnalyticsErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

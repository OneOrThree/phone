package com.oneorthree.phone.outbox.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

/**
 * 내구 이벤트·명령 기반의 도메인 예외 — {@code GlobalExceptionHandler.handleDomain} 이 그대로 받는다.
 */
@Getter
public class OutboxException extends DomainException {

    private final OutboxErrorCode errorCode;

    /**
     * @param errorCode 실패 사유
     */
    public OutboxException(OutboxErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}

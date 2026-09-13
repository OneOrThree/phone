package com.oneorthree.business.common.exception;

import lombok.Getter;

/** 이 서비스가 스스로 내린 판정. 전역 핸들러가 {@link ErrorCode} 그대로 봉투에 싣는다. */
@Getter
public class DomainException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient ErrorCode errorCode;

    public DomainException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}

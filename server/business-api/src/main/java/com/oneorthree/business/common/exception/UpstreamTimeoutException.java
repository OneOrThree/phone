package com.oneorthree.business.common.exception;

/** 전체 요청 또는 상류 시도의 제한 시간이 끝났다. */
public class UpstreamTimeoutException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public UpstreamTimeoutException(String message) {
        super(message);
    }

    public UpstreamTimeoutException(String message, Throwable cause) {
        super(message, cause);
    }
}

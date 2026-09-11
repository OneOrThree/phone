package com.oneorthree.business.common.exception;

/** 제한된 조합 또는 상류 실행 큐가 가득 찼다. */
public class CompositionCapacityExceededException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public CompositionCapacityExceededException(String message) {
        super(message);
    }

    public CompositionCapacityExceededException(String message, Throwable cause) {
        super(message, cause);
    }
}

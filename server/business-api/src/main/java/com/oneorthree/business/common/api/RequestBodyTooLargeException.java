package com.oneorthree.business.common.api;

import java.io.IOException;

/** Servlet 스트림과 Jackson 래핑을 지나도 413으로 식별할 수 있는 내부 예외. */
public final class RequestBodyTooLargeException extends IOException {

    private static final long serialVersionUID = 1L;

    public RequestBodyTooLargeException() {
        super("Request body exceeded its byte limit");
    }

    public static boolean causedBy(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof RequestBodyTooLargeException) {
                return true;
            }
            if (current.getCause() == current) {
                return false;
            }
            current = current.getCause();
        }
        return false;
    }
}

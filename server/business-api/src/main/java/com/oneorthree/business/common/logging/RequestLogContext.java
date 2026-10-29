package com.oneorthree.business.common.logging;

import org.slf4j.MDC;

import java.util.regex.Pattern;

/** 명시적으로 전달받은 요청 ID만 설치한다. tracer 소유 MDC와 다른 스레드의 MDC는 복사하지 않는다. */
public final class RequestLogContext implements AutoCloseable {

    /** 요청 ID 허용 형식 — 상류 context 검증도 이 하나를 쓴다. */
    public static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final String KEY = "request_id";
    private final String previous;

    private RequestLogContext(String requestId) {
        if (requestId == null || !SAFE_ID.matcher(requestId).matches()) {
            throw new IllegalArgumentException("로그 request_id 형식이 올바르지 않습니다.");
        }
        previous = MDC.get(KEY);
        MDC.put(KEY, requestId);
    }

    public static RequestLogContext open(String requestId) {
        return new RequestLogContext(requestId);
    }

    /** 설치한 스레드에서 scope를 닫아 중첩 호출·예외 후에도 이전 요청 문맥을 복원한다. */
    @Override
    public void close() {
        if (previous == null) {
            MDC.remove(KEY);
        } else {
            MDC.put(KEY, previous);
        }
    }
}

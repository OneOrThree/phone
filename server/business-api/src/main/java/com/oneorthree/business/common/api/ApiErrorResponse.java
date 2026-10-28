package com.oneorthree.business.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 신규 외부 오류. 내부/legacy ErrorResponse의 와이어를 바꾸지 않는다. */
public record ApiErrorResponse(Error error, String requestId,
        @JsonInclude(JsonInclude.Include.NON_NULL) PublicCurrentState current) {

    /** field는 값이 없어도 항상 직렬화한다. */
    public record Error(String code, String message,
            @JsonInclude(JsonInclude.Include.ALWAYS) String field, boolean retryable) {
    }
}

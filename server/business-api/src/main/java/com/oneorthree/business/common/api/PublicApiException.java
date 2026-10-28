package com.oneorthree.business.common.api;

import com.oneorthree.business.common.exception.DomainException;
import org.springframework.http.HttpStatus;

/** 신규 도메인의 안전한 공개 오류 정보. current를 허용하는 것은 409뿐이다. */
public class PublicApiException extends DomainException {

    private static final long serialVersionUID = 1L;

    private final String field;
    private final transient PublicCurrentState current;

    public PublicApiException(ApiErrorCode code, String field) {
        this(code, field, null);
    }

    public PublicApiException(ApiErrorCode code, String field, PublicCurrentState current) {
        super(code);
        if (current != null && code.getStatus() != HttpStatus.CONFLICT) {
            throw new IllegalArgumentException("Only a conflict may expose current state");
        }
        this.field = field;
        this.current = current;
    }

    public String getField() {
        return field;
    }

    public PublicCurrentState getCurrent() {
        return current;
    }
}

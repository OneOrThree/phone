package com.oneorthree.phone.magazine.exception;

import com.oneorthree.phone.common.exception.DomainException;

/** 고양이 잡지 도메인의 단일 예외 — 상태 코드와 문구는 {@link MagazineErrorCode} 가 들고 있다. */
public class MagazineException extends DomainException {

    private final MagazineErrorCode errorCode;

    public MagazineException(MagazineErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }

    public MagazineErrorCode getErrorCode() {
        return errorCode;
    }
}

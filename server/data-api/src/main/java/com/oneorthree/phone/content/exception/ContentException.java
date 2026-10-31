package com.oneorthree.phone.content.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

/** 운영 콘텐츠 판정은 공통 오류 봉투로 반환한다. */
@Getter
public class ContentException extends DomainException {
    private final ContentErrorCode errorCode;

    public ContentException(ContentErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}

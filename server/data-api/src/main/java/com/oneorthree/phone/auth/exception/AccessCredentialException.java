package com.oneorthree.phone.auth.exception;

import com.oneorthree.phone.common.exception.CommonErrorCode;
import com.oneorthree.phone.common.exception.DomainException;

/** 선택적으로 제출한 AT도 올바른 동일 세션 자격이어야 한다. 자격 원문은 예외에 담지 않는다. */
public class AccessCredentialException extends DomainException {
    public AccessCredentialException() {
        super(CommonErrorCode.UNAUTHORIZED);
    }

    @Override
    public CommonErrorCode getErrorCode() {
        return CommonErrorCode.UNAUTHORIZED;
    }
}

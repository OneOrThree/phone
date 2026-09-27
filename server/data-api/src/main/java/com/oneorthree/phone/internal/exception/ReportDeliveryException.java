package com.oneorthree.phone.internal.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

@Getter
public class ReportDeliveryException extends DomainException {
    private final ReportDeliveryErrorCode errorCode;

    public ReportDeliveryException(ReportDeliveryErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}

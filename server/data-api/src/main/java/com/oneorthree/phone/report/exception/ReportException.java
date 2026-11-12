package com.oneorthree.phone.report.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

@Getter
public class ReportException extends DomainException {
    private final ReportErrorCode errorCode;

    public ReportException(ReportErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}

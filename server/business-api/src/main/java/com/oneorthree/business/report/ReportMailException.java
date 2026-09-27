package com.oneorthree.business.report;

public class ReportMailException extends RuntimeException {
    public ReportMailException(String message) {
        super(message);
    }

    public ReportMailException(String message, Throwable cause) {
        super(message, cause);
    }
}

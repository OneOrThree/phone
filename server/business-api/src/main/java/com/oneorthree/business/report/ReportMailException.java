package com.oneorthree.business.report;

public class ReportMailException extends RuntimeException {
    private final boolean deliveryMayHaveOccurred;

    public ReportMailException(String message) {
        this(message, null, false);
    }

    public ReportMailException(String message, Throwable cause) {
        this(message, cause, false);
    }

    public ReportMailException(String message, boolean deliveryMayHaveOccurred) {
        this(message, null, deliveryMayHaveOccurred);
    }

    public ReportMailException(String message, Throwable cause, boolean deliveryMayHaveOccurred) {
        super(message, cause);
        this.deliveryMayHaveOccurred = deliveryMayHaveOccurred;
    }

    public boolean deliveryMayHaveOccurred() {
        return deliveryMayHaveOccurred;
    }
}

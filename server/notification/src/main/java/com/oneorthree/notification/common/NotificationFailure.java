package com.oneorthree.notification.common;

public final class NotificationFailure extends RuntimeException {

    private final int status;

    public NotificationFailure(int status, String code) {
        super(code);
        this.status = status;
    }

    public int status() {
        return status;
    }
}

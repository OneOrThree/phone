package com.oneorthree.notification;

final class NotificationFailure extends RuntimeException {

    private final int status;

    NotificationFailure(int status, String code) {
        super(code);
        this.status = status;
    }

    int status() {
        return status;
    }
}

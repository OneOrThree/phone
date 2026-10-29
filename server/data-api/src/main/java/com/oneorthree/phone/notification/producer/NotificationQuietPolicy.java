package com.oneorthree.phone.notification.producer;

/** 조용한 시간의 발송 정책. 실제 판정은 알림 서버가 수행한다. */
public enum NotificationQuietPolicy {
    DROP,
    DEFER
}

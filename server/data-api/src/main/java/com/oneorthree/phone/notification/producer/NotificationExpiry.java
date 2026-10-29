package com.oneorthree.phone.notification.producer;

import static com.oneorthree.phone.common.util.ZonePolicy.KST;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Map;

/** 잡지 알림의 수명을 발행일 다음 날 07:00 KST에 고정한다. 재전달 시각으로 연장하지 않는다. */
public final class NotificationExpiry {
    public static final String OCCURRED_AT = "dedupAt";
    public static final String EXPIRES_AT = "expiresAt";
    private static final LocalTime MAGAZINE_ISSUE_OPENS = LocalTime.of(7, 0);

    private NotificationExpiry() {
    }

    /** @return 잡지 호의 만료 상한. 사실 통보 알림은 별도 시간 제한이 없다. */
    public static Duration validity(NotificationKind kind) {
        return kind == NotificationKind.MAGAZINE_PUBLISHED ? Duration.ofDays(2) : null;
    }

    public static Instant expiresAt(NotificationKind kind, Instant occurredAt) {
        return kind == NotificationKind.MAGAZINE_PUBLISHED
                ? occurredAt.atZone(KST).toLocalDate().plusDays(1)
                        .atTime(MAGAZINE_ISSUE_OPENS).atZone(KST).toInstant()
                : null;
    }

    /** 원사건 시각을 보존하고 시간 제한이 있는 종류에 만료 시각을 더한다. */
    public static void addTo(Map<String, Object> params, NotificationKind kind, Instant occurredAt) {
        if (occurredAt == null) {
            return;
        }
        params.put(OCCURRED_AT, occurredAt.toString());
        Instant expiry = expiresAt(kind, occurredAt);
        if (expiry != null) {
            params.put(EXPIRES_AT, expiry.toString());
        }
    }
}

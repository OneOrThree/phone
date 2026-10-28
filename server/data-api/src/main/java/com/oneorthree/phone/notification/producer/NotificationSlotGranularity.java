package com.oneorthree.phone.notification.producer;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static com.oneorthree.phone.common.util.ZonePolicy.KST;

/** 요청형 알림 사건 키의 시간 축과 경계에 걸친 중복 조회 범위. */
public enum NotificationSlotGranularity {
    MINUTE, DAY, INSTANT;

    private static final DateTimeFormatter DAY_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd");

    static final Duration MINUTE_WIDTH = Duration.ofMinutes(1);

    public String bucketOf(Instant at) {
        return switch (this) {
            case MINUTE -> String.valueOf(at.truncatedTo(ChronoUnit.MINUTES).getEpochSecond());
            case DAY -> at.atZone(KST).toLocalDate().format(DAY_FORMAT);
            case INSTANT -> String.valueOf(at.toEpochMilli());
        };
    }

    /** 분 경계의 같은 사건을 찾은 뒤 생산자가 실제 시각 차이를 다시 검사한다. */
    public List<String> lookupBucketsOf(Instant at) {
        if (this != MINUTE) {
            return List.of(bucketOf(at));
        }
        return List.of(bucketOf(at), bucketOf(at.minus(MINUTE_WIDTH)), bucketOf(at.plus(MINUTE_WIDTH)));
    }
}

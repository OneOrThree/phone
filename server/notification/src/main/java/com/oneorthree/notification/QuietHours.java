package com.oneorthree.notification;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Map;

final class QuietHours {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private QuietHours() { }

    /** null 사용자 설정은 현행 23–07 기본값. start=end는 빈 조용한 구간이다. */
    static Instant endIfQuiet(Map<String, Object> settings, Instant now) {
        LocalTime start = LocalTime.of(23, 0);
        LocalTime end = LocalTime.of(7, 0);
        if (Boolean.TRUE.equals(settings.get("nightModeEnabled")) && settings.get("nightStartTime") != null
                && settings.get("nightEndTime") != null) {
            start = LocalTime.parse(settings.get("nightStartTime").toString());
            end = LocalTime.parse(settings.get("nightEndTime").toString());
        }
        ZonedDateTime local = now.atZone(KST);
        LocalTime time = local.toLocalTime();
        boolean overnight = start.isAfter(end);
        boolean quiet = !start.equals(end) && (overnight ? !time.isBefore(start) || time.isBefore(end)
                : !time.isBefore(start) && time.isBefore(end));
        if (!quiet) {
            return null;
        }
        ZonedDateTime next = local.toLocalDate().atTime(end).atZone(KST);
        return (overnight && !time.isBefore(start) ? next.plusDays(1) : next).toInstant();
    }
}

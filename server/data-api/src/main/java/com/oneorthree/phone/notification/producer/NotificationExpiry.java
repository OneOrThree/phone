package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.notification.migration.NotificationCronReplayJob;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Map;

/** 원사건 시각에 고정된 발송 만료. relay·DLT·이관·재생 시각으로 수명을 다시 시작하지 않는다. */
public final class NotificationExpiry {
    public static final String OCCURRED_AT = "dedupAt";
    public static final String EXPIRES_AT = "expiresAt";
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private NotificationExpiry() {
    }

    /** @return 정본 재생 계약의 시간 제한. 사실 통보·별도 도메인 마감 판정 종류는 null이다. */
    public static Duration validity(NotificationKind kind) {
        NotificationCronReplayJob job = switch (kind) {
            case LEAGUE_WEEKLY_RESULT -> NotificationCronReplayJob.LEAGUE_WEEKLY_RESULTS;
            case LEAGUE_DEADLINE -> NotificationCronReplayJob.LEAGUE_DEADLINE;
            case LEAGUE_DEADLINE_D1, LEAGUE_RELEGATION_WARNING -> NotificationCronReplayJob.LEAGUE_SUNDAY_CRISIS;
            case LEAGUE_RELEGATION_WARNING_EVENING -> NotificationCronReplayJob.LEAGUE_RELEGATION_WARNING;
            case LEAGUE_FINAL_DEADLINE -> NotificationCronReplayJob.LEAGUE_FINAL_DEADLINE;
            case MISSED_FOCUS_TODAY -> NotificationCronReplayJob.MISSED_FOCUS_TODAY;
            case STREAK_AT_RISK -> NotificationCronReplayJob.STREAK_AT_RISK;
            case INACTIVE_RETURN -> NotificationCronReplayJob.INACTIVE_RETURN;
            case CHALLENGE_WINDOW_END -> NotificationCronReplayJob.CHALLENGE_WINDOW_END;
            case CHALLENGE_ENDED -> NotificationCronReplayJob.CHALLENGE_DURATION_END;
            default -> null;
        };
        return job == null ? null : job.validity();
    }

    /** 크론이 몇 분 늦어도 리그 마감·오늘·조용한 시간 경계를 넘어 유효해지지 않는다. */
    public static Instant expiresAt(NotificationKind kind, Instant occurredAt) {
        Duration validity = validity(kind);
        if (validity == null) {
            return null;
        }
        Instant expiry = occurredAt.plus(validity);
        var date = occurredAt.atZone(KST).toLocalDate();
        Instant calendarLimit = switch (kind) {
            case LEAGUE_DEADLINE, LEAGUE_DEADLINE_D1, LEAGUE_RELEGATION_WARNING,
                 LEAGUE_RELEGATION_WARNING_EVENING, LEAGUE_FINAL_DEADLINE, STREAK_AT_RISK ->
                    date.plusDays(1).atStartOfDay(KST).toInstant();
            case INACTIVE_RETURN, MISSED_FOCUS_TODAY, CHALLENGE_ENDED ->
                    date.atTime(23, 0).atZone(KST).toInstant();
            default -> expiry;
        };
        return expiry.isBefore(calendarLimit) ? expiry : calendarLimit;
    }

    /** @param params 저장되는 원문 params. 원본 사건 시각이 있을 때만 그 값으로 메타데이터를 만든다. */
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

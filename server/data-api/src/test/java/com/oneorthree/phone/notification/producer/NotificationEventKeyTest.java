package com.oneorthree.phone.notification.producer;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 결정적 사건 키 — <b>dedup 의 유일한 근거</b>라 축 하나가 어긋나면 알림이 사라지거나 두 번 간다.
 *
 * <p>여기서 지키는 성질은 셋이다: 같은 입력은 같은 키, 다른 사건은 다른 키, 그리고 시간축이 있는
 * 종류에 원본 시각이 없으면 <b>조용히 「지금」으로 접히지 않고 죽는다</b>.
 */
class NotificationEventKeyTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
    private static final UUID SUBJECT = UUID.fromString("00000000-0000-0000-0000-0000000000bb");

    private static Instant kst(int year, int month, int day, int hour, int minute) {
        return LocalDate.of(year, month, day).atTime(LocalTime.of(hour, minute)).atZone(KST).toInstant();
    }

    @Test
    @DisplayName("시간축이 없는 종류는 (kind, 유저, 대상) 셋으로만 접힌다 — 구 선점 유니크와 같은 축")
    void noneAxisFoldsOnSubjectOnly() {
        String first = NotificationEventKey.of(NotificationKind.BET_RESULT, USER, SUBJECT,
                kst(2026, 9, 11, 10, 0));
        String later = NotificationEventKey.of(NotificationKind.BET_RESULT, USER, SUBJECT,
                kst(2026, 9, 20, 3, 0));

        // 구 유니크 (user_id, kind, subject_id) 에 시간축이 없었다 — 9일 뒤 재훑기가 같은 회차를
        // 다시 집어도 같은 키여야 결과 푸시가 두 번 나가지 않는다.
        assertThat(first).isEqualTo(later);
        assertThat(first).isEqualTo("noti:BET_RESULT:" + USER + ":" + SUBJECT + ":none");
    }

    @Test
    @DisplayName("같은 회차라도 결과와 환불은 다른 키다 — kind 축이 없으면 한 건으로 접힌다")
    void kindSeparatesResultFromRefund() {
        assertThat(NotificationEventKey.of(NotificationKind.BET_RESULT, USER, SUBJECT, null))
                .isNotEqualTo(NotificationEventKey.of(NotificationKind.BET_VOID_REFUND, USER, SUBJECT, null));
    }

    @Test
    @DisplayName("DAY 축은 KST 날짜로 접힌다 — 같은 날 여러 틱은 한 건, 다음 날은 새 건")
    void dayAxisFoldsWithinKstDay() {
        String morning = NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, USER, SUBJECT,
                kst(2026, 9, 11, 0, 15));
        String evening = NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, USER, SUBJECT,
                kst(2026, 9, 11, 23, 45));
        String nextDay = NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, USER, SUBJECT,
                kst(2026, 9, 12, 0, 15));

        assertThat(morning).isEqualTo(evening).endsWith(":20260911");
        // 창은 매일 반복된다 — 날이 바뀌어도 같은 키면 다음 날부터 영영 안 나간다.
        assertThat(nextDay).isNotEqualTo(morning).endsWith(":20260912");
    }

    @Test
    @DisplayName("WEEK 축은 그 주 월요일로 접힌다 — 일요일도 같은 주다")
    void weekAxisFoldsToMonday() {
        // 2026-09-11 은 금요일, 그 주 월요일은 2026-09-07 이다.
        String friday = NotificationEventKey.of(NotificationKind.LEAGUE_WEEKLY_RESULT, USER, null,
                kst(2026, 9, 11, 7, 0));
        String sunday = NotificationEventKey.of(NotificationKind.LEAGUE_WEEKLY_RESULT, USER, null,
                kst(2026, 9, 13, 7, 0));
        String nextMonday = NotificationEventKey.of(NotificationKind.LEAGUE_WEEKLY_RESULT, USER, null,
                kst(2026, 9, 14, 7, 0));

        assertThat(friday).isEqualTo(sunday).endsWith(":20260907");
        assertThat(nextMonday).endsWith(":20260914");
    }

    @Test
    @DisplayName("강등 경고 아침·저녁은 문구가 같아도 다른 키다 — 한 kind 로 두면 저녁분이 사라진다")
    void eveningRelegationWarningIsASeparateKey() {
        Instant morning = kst(2026, 9, 13, 9, 0);
        Instant evening = kst(2026, 9, 13, 18, 0);

        // 같은 DAY 버킷이다. kind 를 가르지 않았다면 저녁 재발송이 아침 키에 접혀 영영 안 나간다.
        assertThat(NotificationEventKey.of(NotificationKind.LEAGUE_RELEGATION_WARNING, USER, null, morning))
                .isNotEqualTo(NotificationEventKey.of(
                        NotificationKind.LEAGUE_RELEGATION_WARNING_EVENING, USER, null, evening));
    }

    @Test
    @DisplayName("MINUTE 축은 분 단위로 접힌다 — 구 「최근 1분」 dedup 창을 그대로 옮긴 폭")
    void minuteAxisFoldsWithinMinute() {
        Instant at = Instant.parse("2026-09-11T10:20:00Z");
        assertThat(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT,
                at.plusSeconds(59)))
                .isEqualTo(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, at));
        assertThat(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT,
                at.plusSeconds(60)))
                .isNotEqualTo(NotificationEventKey.of(NotificationKind.FRIEND_REQUEST, USER, SUBJECT, at));
    }

    @Test
    @DisplayName("시간축이 있는데 원본 시각이 없으면 죽는다 — 「없으면 지금」으로 접히면 멱등이 무너진다")
    void missingEventTimeFailsLoudly() {
        assertThatThrownBy(() ->
                NotificationEventKey.of(NotificationKind.STREAK_AT_RISK, USER, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("원본 사건 시각");
    }

    @Test
    @DisplayName("시간축이 NONE 이면 원본 시각이 없어도 된다 — 대상 id 가 이미 유일성을 준다")
    void noneAxisAllowsMissingEventTime() {
        assertThat(NotificationEventKey.of(NotificationKind.CHALLENGE_CREATED, USER, SUBJECT, null))
                .endsWith(":none");
    }

    @Test
    @DisplayName("대상 없는 종류는 자리표가 들어간다 — 빈 문자열이면 구분자가 붙어 «::» 가 된다")
    void absentSubjectUsesPlaceholder() {
        assertThat(NotificationEventKey.of(NotificationKind.MISSED_FOCUS_TODAY, USER, null,
                kst(2026, 9, 11, 21, 0)))
                .isEqualTo("noti:MISSED_FOCUS_TODAY:" + USER + ":none:20260911");
    }
}

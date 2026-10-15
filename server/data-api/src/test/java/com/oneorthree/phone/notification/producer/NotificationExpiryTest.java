package com.oneorthree.phone.notification.producer;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/** 종료 알림의 원사건 시각을 회차 종료로 옮겨도(GROMO-893 ⑦) 발송 만료가 줄거나 늘지 않는다. */
class NotificationExpiryTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2027, 2, 11);

    @Test
    @DisplayName("일 목표 마감은 자정(회차 종료) 기준이어도 09:00 크론 기준과 같은 23:00 에 만료된다")
    void durationEndAnchoredAtCycleEndKeepsTheCronSlotDeadline() {
        Instant cycleEnd = DAY.atStartOfDay(KST).toInstant();
        Instant cronSlot = DAY.atTime(LocalTime.of(9, 0)).atZone(KST).toInstant();
        Instant quietStart = DAY.atTime(LocalTime.of(23, 0)).atZone(KST).toInstant();

        assertThat(NotificationExpiry.expiresAt(NotificationKind.CHALLENGE_ENDED, cycleEnd)).isEqualTo(quietStart);
        assertThat(NotificationExpiry.expiresAt(NotificationKind.CHALLENGE_ENDED, cronSlot)).isEqualTo(quietStart);
    }

    @Test
    @DisplayName("창 종료는 회차 종료 시각부터 24시간 유효하다 — 감지 틱이 자정을 넘겨도 수명이 다시 시작되지 않는다")
    void windowEndValidityRunsFromTheCycleEnd() {
        Instant cycleEnd = DAY.atTime(LocalTime.of(23, 40)).atZone(KST).toInstant();

        assertThat(NotificationExpiry.expiresAt(NotificationKind.CHALLENGE_WINDOW_END, cycleEnd))
                .isEqualTo(cycleEnd.plus(Duration.ofHours(24)));
    }
}

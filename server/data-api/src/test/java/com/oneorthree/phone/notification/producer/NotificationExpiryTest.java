package com.oneorthree.phone.notification.producer;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

/** 잡지 발행 알림은 다음 호 발행 시각에 만료된다. */
class NotificationExpiryTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2027, 2, 11);

    @Test
    @DisplayName("잡지 발행 알림은 호 날짜 다음 날 07:00 KST 에 만료된다 — 다음 호 발행 뒤에는 지난 호가 나가지 않는다")
    void magazinePublishedExpiresWhenTheNextIssueIsOut() {
        Instant published = DAY.atTime(LocalTime.of(7, 0)).atZone(KST).toInstant();

        assertThat(NotificationExpiry.validity(NotificationKind.MAGAZINE_PUBLISHED)).isNotNull();
        assertThat(NotificationExpiry.expiresAt(NotificationKind.MAGAZINE_PUBLISHED, published))
                .isEqualTo(DAY.plusDays(1).atTime(LocalTime.of(7, 0)).atZone(KST).toInstant());
    }
}

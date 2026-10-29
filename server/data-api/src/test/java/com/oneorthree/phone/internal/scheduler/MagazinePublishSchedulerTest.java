package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 자정 이후에도 실제 cron이 돌고 미완료 호의 원래 날짜로 재시도하는 계약. */
class MagazinePublishSchedulerTest {
    private static final LocalDate ISSUE_DATE = LocalDate.of(2034, 5, 10);

    @Test
    void latePublicationHasMidnightAndOvernightRetryTicks() throws Exception {
        Scheduled scheduled = MagazinePublishScheduler.class.getMethod("publishToday").getAnnotation(Scheduled.class);
        CronExpression cron = CronExpression.parse(scheduled.cron());
        ZonedDateTime published = ISSUE_DATE.atTime(23, 55).atZone(ZonePolicy.KST);
        ZonedDateTime midnight = ISSUE_DATE.plusDays(1).atStartOfDay(ZonePolicy.KST);
        assertThat(cron.next(published)).isEqualTo(midnight);
        assertThat(cron.next(midnight)).isEqualTo(midnight.plusMinutes(10));
    }

    @Test
    void midnightRetriesTheOriginalIssueDate() {
        MagazineIssueNotifier notifier = mock(MagazineIssueNotifier.class);
        var now = ISSUE_DATE.plusDays(1).atStartOfDay(ZonePolicy.KST).toInstant();
        when(notifier.pendingIssueDates(now)).thenReturn(List.of(ISSUE_DATE));
        when(notifier.notifyIfPending(ISSUE_DATE, now)).thenReturn(new MagazineIssueNotifier.Result(true, 0));
        new MagazinePublishScheduler(notifier, Clock.fixed(now, ZonePolicy.KST)).publishToday();
        verify(notifier).notifyIfPending(ISSUE_DATE, now);
    }
}

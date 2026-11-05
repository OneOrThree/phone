package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import com.oneorthree.phone.internal.service.MagazinePublishService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 07시 자동 발행·실패 재시도와 자정 이후 미완료 알림 재시도를 함께 보장한다. */
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
        MagazinePublishService publisher = mock(MagazinePublishService.class);
        MagazineIssueNotifier notifier = mock(MagazineIssueNotifier.class);
        var now = ISSUE_DATE.plusDays(1).atStartOfDay(ZonePolicy.KST).toInstant();
        when(notifier.pendingIssueDates(now)).thenReturn(List.of(ISSUE_DATE));
        when(notifier.notifyIfPending(ISSUE_DATE, now)).thenReturn(new MagazineIssueNotifier.Result(true, 0));
        new MagazinePublishScheduler(publisher, notifier, Clock.fixed(now, ZonePolicy.KST)).publishToday();
        verifyNoInteractions(publisher);
        verify(notifier).notifyIfPending(ISSUE_DATE, now);
    }

    @ParameterizedTest
    @CsvSource({"0,0", "6,50", "6,59"})
    void doesNotPublishBeforeSeven(int hour, int minute) {
        MagazinePublishService publisher = mock(MagazinePublishService.class);
        MagazineIssueNotifier notifier = mock(MagazineIssueNotifier.class);
        var now = ISSUE_DATE.atTime(hour, minute).atZone(ZonePolicy.KST).toInstant();
        new MagazinePublishScheduler(publisher, notifier, Clock.fixed(now, ZonePolicy.KST)).publishToday();
        verifyNoInteractions(publisher);
        verify(notifier).pendingIssueDates(now);
    }

    @ParameterizedTest
    @CsvSource({"7,0", "7,10", "18,20", "23,50"})
    void publishesKstDateBeforeNotifying(int hour, int minute) {
        MagazinePublishService publisher = mock(MagazinePublishService.class);
        MagazineIssueNotifier notifier = mock(MagazineIssueNotifier.class);
        var now = ISSUE_DATE.atTime(hour, minute).atZone(ZonePolicy.KST).toInstant();
        when(notifier.pendingIssueDates(now)).thenReturn(List.of(ISSUE_DATE));
        when(notifier.notifyIfPending(ISSUE_DATE, now)).thenReturn(new MagazineIssueNotifier.Result(true, 0));
        // Clock이 UTC여도 발행일과 07시 경계는 KST로 결정한다.
        new MagazinePublishScheduler(publisher, notifier, Clock.fixed(now, ZoneOffset.UTC)).publishToday();
        var order = inOrder(publisher, notifier);
        order.verify(publisher).publish(ISSUE_DATE);
        order.verify(notifier).pendingIssueDates(now);
        order.verify(notifier).notifyIfPending(ISSUE_DATE, now);
    }

    @Test
    void publicationFailureStillRetriesNotificationsAndPublishesOnNextTick() {
        MagazinePublishService publisher = mock(MagazinePublishService.class);
        MagazineIssueNotifier notifier = mock(MagazineIssueNotifier.class);
        Clock clock = mock(Clock.class);
        Instant first = ISSUE_DATE.atTime(7, 0).atZone(ZonePolicy.KST).toInstant();
        Instant retry = first.plusSeconds(600);
        when(clock.instant()).thenReturn(first, first, retry, retry);
        when(publisher.publish(ISSUE_DATE)).thenThrow(new IllegalStateException("시험용 발행 실패"))
                .thenReturn(Optional.empty());
        when(notifier.pendingIssueDates(first)).thenReturn(List.of(ISSUE_DATE));
        when(notifier.pendingIssueDates(retry)).thenReturn(List.of(ISSUE_DATE));
        when(notifier.notifyIfPending(ISSUE_DATE, first)).thenThrow(new IllegalStateException("시험용 알림 실패"));
        when(notifier.notifyIfPending(ISSUE_DATE, retry)).thenReturn(new MagazineIssueNotifier.Result(true, 0));
        var scheduler = new MagazinePublishScheduler(publisher, notifier, clock);
        scheduler.publishToday();
        scheduler.publishToday();
        verify(publisher, times(2)).publish(ISSUE_DATE);
        verify(notifier).notifyIfPending(ISSUE_DATE, first);
        verify(notifier).notifyIfPending(ISSUE_DATE, retry);
    }

    @Test
    void notificationScanUsesTimeAfterPublication() {
        MagazinePublishService publisher = mock(MagazinePublishService.class);
        MagazineIssueNotifier notifier = mock(MagazineIssueNotifier.class);
        Clock clock = mock(Clock.class);
        Instant start = ISSUE_DATE.atTime(7, 0).atZone(ZonePolicy.KST).toInstant();
        Instant committed = start.plusSeconds(5);
        when(clock.instant()).thenReturn(start, committed);
        when(notifier.pendingIssueDates(committed)).thenReturn(List.of(ISSUE_DATE));
        when(notifier.notifyIfPending(ISSUE_DATE, committed)).thenReturn(new MagazineIssueNotifier.Result(true, 0));
        new MagazinePublishScheduler(publisher, notifier, clock).publishToday();
        verify(notifier).pendingIssueDates(committed);
        verify(notifier).notifyIfPending(ISSUE_DATE, committed);
    }
}

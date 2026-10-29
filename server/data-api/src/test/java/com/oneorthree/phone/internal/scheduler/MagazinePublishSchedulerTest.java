package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZonedDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** 알림 펼치기 결과의 로그 분기(GROMO-2307) — 그날 마지막 틱의 남은 실패만 최종 error 다. */
class MagazinePublishSchedulerTest {

    private static final LocalDate TODAY = LocalDate.of(2034, 5, 10);
    private final MagazinePublishScheduler scheduler = new MagazinePublishScheduler(
            mock(MagazineIssueNotifier.class), Clock.systemUTC());

    private static ZonedDateTime at(int hour, int minute) {
        return ZonedDateTime.of(TODAY, java.time.LocalTime.of(hour, minute), ZonePolicy.KST);
    }

    @Test
    @DisplayName("실패가 남아도 23:40 까지는 다음 틱 재시도(warn), 23:50 마지막 틱은 최종 실패(error)")
    void onlyTheLastTickIsAFinalFailure() {
        MagazineIssueNotifier.Result failed = new MagazineIssueNotifier.Result(false, 2);
        assertThat(scheduler.reportNotify(failed, at(23, 40), TODAY)).isFalse();
        assertThat(scheduler.reportNotify(failed, at(23, 50), TODAY)).isTrue();
        assertThat(scheduler.reportNotify(new MagazineIssueNotifier.Result(true, 0), at(23, 50), TODAY)).isFalse();
    }
}

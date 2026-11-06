package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import com.oneorthree.phone.internal.service.MagazinePublishService;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;

/**
 * KST 07시부터 23시 50분까지 오늘 호를 백오피스 검토 없이 자동 발행한다. 같은 날짜의 호는 한 번만 만든다.
 * 유효 호의 미완료 알림은 자정과 관계없이 10분마다 재시도하며, 발행일 다음 날 07시 이후에는 새로 펼치지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MagazinePublishScheduler {
    private static final LocalTime LAST_TICK = LocalTime.of(23, 50);

    private final MagazinePublishService publisher;
    private final MagazineIssueNotifier notifier;
    private final Clock clock;

    @Scheduled(cron = "0 0/10 * * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "magazine-publish", lockAtMostFor = "PT9M", lockAtLeastFor = "PT1M")
    public void publishToday() {
        Instant now = clock.instant();
        if (MagazineCalendar.isWindowOpen(now)) {
            var kst = now.atZone(ZonePolicy.KST);
            try {
                publisher.publish(kst.toLocalDate());
            } catch (RuntimeException failure) {
                if (kst.toLocalTime().isBefore(LAST_TICK)) {
                    log.warn("고양이 잡지 발행 실패 — 다음 틱(10분 뒤)에 다시 한다 date={}", kst.toLocalDate(), failure);
                } else {
                    log.error("고양이 잡지 발행이 그날 마지막 틱까지 실패했다 — 수동 확인 필요 date={}", kst.toLocalDate(), failure);
                }
            }
        }
        // 발행 중 시간이 흘렀으므로 새 호의 published_at과 만료 경계를 실제 알림 시점으로 판단한다.
        Instant notificationTime = clock.instant();
        // 날짜가 바뀌어도 notified_at이 NULL인 유효 호를 읽으므로 마지막 틱 이후 게시도 복구된다.
        for (LocalDate issueDate : notifier.pendingIssueDates(notificationTime)) {
            try {
                MagazineIssueNotifier.Result result = notifier.notifyIfPending(issueDate, notificationTime);
                if (!result.complete()) {
                    log.warn("고양이 잡지 알림 일시 실패 — 실패 {}건 — 유효기간 내 다음 틱에 재시도 date={}",
                            result.failed(), issueDate);
                }
            } catch (RuntimeException failure) {
                log.warn("고양이 잡지 알림 펼치기 실패 — 유효기간 내 다음 틱에 이어서 한다 date={}", issueDate, failure);
            }
        }
    }
}

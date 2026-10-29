package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;

/**
 * 승인 게시된 유효 호의 미완료 알림을 자정과 관계없이 10분마다 재시도한다.
 * 미검토 호를 만들지 않으며, 발행일 다음 날 07시가 지난 호는 새로 펼치지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MagazinePublishScheduler {
    private final MagazineIssueNotifier notifier;
    private final Clock clock;

    @Scheduled(cron = "0 0/10 * * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "magazine-publish", lockAtMostFor = "PT9M", lockAtLeastFor = "PT1M")
    public void publishToday() {
        Instant now = clock.instant();
        // 날짜가 바뀌어도 notified_at이 NULL인 유효 호를 읽으므로 마지막 틱 이후 게시도 복구된다.
        for (LocalDate issueDate : notifier.pendingIssueDates(now)) {
            try {
                MagazineIssueNotifier.Result result = notifier.notifyIfPending(issueDate, now);
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

package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/**
 * 승인 게시된 오늘 호의 알림만 07:00~23:50 KST에 재시도한다.
 * 미검토 호를 만들던 자동 발행은 관리 게시 API로 옮겼다. 새 호가 없으면 알림 서비스도 아무 일도 하지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MagazinePublishScheduler {

    /** 그날 마지막 알림 재시도 시각. */
    private static final LocalTime LAST_TICK = LocalTime.of(23, 50);

    private final MagazineIssueNotifier notifier;
    private final Clock clock;

    /**
     * 전송 오류가 남은 결과를 로그로 알린다 — 그날 마지막 틱이면 다음 날은 다른 날짜만 조회해 이 호가 다시 시도되지 않으므로
     * error(수동 확인 필요)다.
     *
     * @return 마지막 틱의 최종 실패(error)면 true
     */
    boolean reportNotify(MagazineIssueNotifier.Result result, ZonedDateTime now, LocalDate today) {
        if (result.complete()) {
            return false;
        }
        if (now.toLocalTime().isBefore(LAST_TICK)) {
            log.warn("고양이 잡지 알림 일시 실패 — 실패 {}건 — 다음 틱(10분 뒤)에 이어서 한다 date={}", result.failed(), today);
            return false;
        }
        log.error("고양이 잡지 알림이 그날 마지막 틱까지 실패분 {}건을 남겼다 — 수동 확인 필요 date={}", result.failed(), today);
        return true;
    }

    @Scheduled(cron = "0 0/10 7-23 * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "magazine-publish", lockAtMostFor = "PT9M", lockAtLeastFor = "PT1M")
    public void publishToday() {
        ZonedDateTime now = ZonedDateTime.now(clock.withZone(ZonePolicy.KST));
        LocalDate today = now.toLocalDate();
        // 운영자가 승인한 스냅샷은 관리 게시 API만 공개한다. 크론은 미검토 호를 만들지 않는다.
        // 이미 게시된 오늘 호의 알림만 기존 멱등 경로로 이어서 처리한다.
        try {
            reportNotify(notifier.notifyIfPending(today, clock.instant()), now, today);
        } catch (RuntimeException failure) {
            if (now.toLocalTime().isBefore(LAST_TICK)) {
                log.warn("고양이 잡지 알림 펼치기 실패 — 다음 틱(10분 뒤)에 이어서 한다 date={}", today, failure);
            } else {
                log.error("고양이 잡지 알림 펼치기가 그날 마지막 틱까지 실패했다 date={}", today, failure);
            }
        }
    }
}

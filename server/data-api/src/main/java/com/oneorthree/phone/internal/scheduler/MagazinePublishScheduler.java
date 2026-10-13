package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.internal.service.MagazinePublishService;
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
 * 고양이 잡지 07시 발행 트리거 (GROMO-2289, 잡지 구현 계획 §4-2) — 07:00 부터 23:50 까지 10분마다(KST) 그날 호를 확인한다.
 * 발행이 멱등이라(이미 그날 호가 있으면 행 하나 확인하고 끝) 첫 시도가 실패해도 그날 안에 저절로 다시 한다. 로직은
 * {@link MagazinePublishService} 에 있고 여기는 시각·잠금·로그뿐이다.
 *
 * <p>틱 안에서 다시 시도하지 않는다 — 10분 뒤 틱이 그 재시도다. 그날 마지막 틱(23:50)까지 실패하면 그날 호는 없다 →
 * error 로그. 앱은 어제 호를 계속 보여 주되 현재 호가 아니라 동그라미가 없다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MagazinePublishScheduler {

    /** 그날 마지막 틱 — 이 틱의 실패는 «오늘 호 없음» 이다. */
    private static final LocalTime LAST_TICK = LocalTime.of(23, 50);

    private final MagazinePublishService publisher;
    private final Clock clock;

    @Scheduled(cron = "0 0/10 7-23 * * *", zone = ZonePolicy.KST_ID)
    @SchedulerLock(name = "magazine-publish", lockAtMostFor = "PT9M", lockAtLeastFor = "PT1M")
    public void publishToday() {
        ZonedDateTime now = ZonedDateTime.now(clock.withZone(ZonePolicy.KST));
        LocalDate today = now.toLocalDate();
        try {
            publisher.publish(today);
        } catch (RuntimeException failure) {
            if (now.toLocalTime().isBefore(LAST_TICK)) {
                log.warn("고양이 잡지 발행 실패 — 다음 틱(10분 뒤)에 다시 한다 date={}", today, failure);
            } else {
                log.error("고양이 잡지 발행이 그날 마지막 틱까지 실패했다 — 오늘 호가 없다 date={}", today, failure);
            }
        }
    }
}

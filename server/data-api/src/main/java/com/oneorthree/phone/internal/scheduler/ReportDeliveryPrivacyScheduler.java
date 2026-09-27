package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.user.repository.ReportDeliveryPrivacyRepository;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 중단된 신고의 증거·설명·회신 이메일 snapshot을 24시간 안에 제거한다. */
@Component
@RequiredArgsConstructor
public class ReportDeliveryPrivacyScheduler {

    private final ReportDeliveryPrivacyRepository reports;

    @Scheduled(cron = "0 17 * * * *", zone = "UTC")
    @SchedulerLock(name = "report-delivery-privacy-cleanup", lockAtMostFor = "PT10M")
    public void purgeStale() {
        reports.purgeStale();
    }
}

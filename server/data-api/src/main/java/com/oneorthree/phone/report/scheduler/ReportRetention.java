package com.oneorthree.phone.report.scheduler;

import com.oneorthree.phone.report.repository.ReportRepository;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** 종결 뒤 30일이 지난 일반 신고를 파기한다. 적법한 보존 예외는 운영 절차로 별도 관리한다. */
@Component
@RequiredArgsConstructor
public class ReportRetention {
    private final ReportRepository reports;

    @Scheduled(fixedDelayString = "${reports.purge-delay-ms:3600000}")
    @Transactional
    @SchedulerLock(name = "safety-report-retention", lockAtMostFor = "PT30M", lockAtLeastFor = "PT30S")
    public void purge() {
        reports.purgeClosed(Instant.now().minus(30, ChronoUnit.DAYS));
    }
}

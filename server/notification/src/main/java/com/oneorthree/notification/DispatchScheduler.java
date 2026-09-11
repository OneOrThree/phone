package com.oneorthree.notification;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "notification.scheduling-enabled", havingValue = "true")
class DispatchScheduler {
    private final JobRegistry jobs;

    DispatchScheduler(JobRegistry jobs) {
        this.jobs = jobs;
    }

    @Scheduled(fixedDelay = 1000)
    @SchedulerLock(name = "notification-registry", lockAtMostFor = "PT1H")
    public void tick() {
        jobs.tick();
    }
}

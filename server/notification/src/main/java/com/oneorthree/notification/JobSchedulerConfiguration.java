package com.oneorthree.notification;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** 전체 사용자 조회가 발송·ack 회차를 붙들지 않도록 실행 스레드와 주기를 분리한다. */
@Configuration
@ConditionalOnProperty(name = "notification.scheduling-enabled", havingValue = "true")
class JobSchedulerConfiguration {
    @Bean
    ThreadPoolTaskScheduler notificationDispatchScheduler() {
        return scheduler("notification-dispatch-");
    }

    @Bean
    ThreadPoolTaskScheduler notificationSnapshotScheduler() {
        return scheduler("notification-snapshot-");
    }

    private static ThreadPoolTaskScheduler scheduler(String prefix) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        // 각 fixedDelay 실행은 끝난 뒤에만 다시 예약된다. 비동기 작업을 별도 큐에 쌓지 않는다.
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix(prefix);
        scheduler.setWaitForTasksToCompleteOnShutdown(false);
        scheduler.setAwaitTerminationSeconds(5);
        return scheduler;
    }
}

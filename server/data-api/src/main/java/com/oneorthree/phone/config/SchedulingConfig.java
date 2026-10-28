package com.oneorthree.phone.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * 스케줄러 인프라 활성화 진입점 (@Scheduled 사용을 위한 설정)
 */
@Configuration
public class SchedulingConfig {

    /** 섬 퀘스트·건설 정산 전용 스케줄러. */
    public static final String SETTLEMENT_SCHEDULER = "settlementTaskScheduler";

    @Bean(SETTLEMENT_SCHEDULER)
    public ThreadPoolTaskScheduler settlementTaskScheduler() {
        return scheduler(3, "settle-sched-");
    }

    /**
     * 집중 보상 분당 적립 전용 스케줄러 빈 이름 (GROMO-1990) — {@code FocusRewardScheduler} 가
     * {@code @Scheduled(scheduler = …)} 로 지정한다. 정산 풀과 나눠 둔 이유는 그 빈 주석에 있다.
     */
    public static final String FOCUS_REWARD_SCHEDULER = "focusRewardTaskScheduler";

    /** 프레즌스 복구·섬 랭킹·평균 집중 통계 등 공용 크론 풀. */
    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        return scheduler(6, "sched-");
    }

    /** 분당 보상·황금 물고기·휴식 자동 종료를 섬 건설 정산과 분리한다. */
    @Bean(FOCUS_REWARD_SCHEDULER)
    public ThreadPoolTaskScheduler focusRewardTaskScheduler() {
        return scheduler(1, "focus-reward-sched-");
    }

    /**
     * 공통 조립 — 종료 시 진행 중인 크론이 끝날 시간을 준다. 발송 도중 강제 종료되면 클레임이
     * PENDING 으로 남고(다음 틱 회수), 정산 도중이면 트랜잭션이 롤백돼 다음 틱이 재시도한다.
     */
    private static ThreadPoolTaskScheduler scheduler(int poolSize, String threadNamePrefix) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(poolSize);
        scheduler.setThreadNamePrefix(threadNamePrefix);
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        return scheduler;
    }
}

/**
 * {@code @Scheduled} 트리거 활성화 — CI 테스트에서는 픽스처를 변경하는 크론이 테스트 격리를 깨뜨리지
 * 않도록 트리거만 끈다. {@link SchedulingConfig}의 스케줄러 빈과 크론 애노테이션은 남겨 배선 검증은
 * 계속 수행할 수 있다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "app.scheduling", name = "enabled", havingValue = "true",
        matchIfMissing = true)
@EnableScheduling
class SchedulingActivationConfig {
}

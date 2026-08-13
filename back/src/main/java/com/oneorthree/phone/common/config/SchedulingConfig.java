package com.oneorthree.phone.common.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

// 스케줄러 인프라 활성화 진입점 (@Scheduled 사용을 위한 설정)
@Configuration
public class SchedulingConfig {

    /**
     * 돈 처리(정산·무산 환불·회차 개설) 전용 스케줄러 빈 이름 — {@code GroupBetScheduler} 의
     * {@code @Scheduled(scheduler = …)} 가 이 이름으로 지정한다.
     *
     * <p><b>왜 풀을 키우는 게 아니라 격리인가.</b> 공용 풀에서는 알림 팬아웃이 슬롯을 먼저 차지하면
     * 정산이 그 뒤에 줄을 선다 — 크론이 늘어날 때마다 같은 경합이 재발하므로 풀 크기 조정은 미봉이다.
     * 전용 풀이면 알림이 아무리 늘어져도 정산 스레드를 잠식할 수 없다. <b>돈 처리는 알림에 밀리면
     * 안 된다</b>: 정산 지연은 24h 자동 환불(N21) 시한을 갉아먹고, 인원 미달 환불 지연은 참가비가
     * 묶인 시간을 그대로 늘린다.
     */
    public static final String SETTLEMENT_SCHEDULER = "settlementTaskScheduler";

    /**
     * 공용 크론 풀 — 알림 팬아웃과 그 밖의 잡([리그 주간 배치·orphan 정리])이 쓴다.
     * Spring 이 {@code TaskScheduler} 빈을 못 찾으면 모든 {@code @Scheduled} 가 스레드 <b>하나</b>를
     * 공유하므로, 이 빈이 없으면 알림 하나가 늦어질 때 나머지 전부가 멈춘다.
     *
     * <p><b>풀 크기 6의 근거(실측 기준 — 크론 수를 세었다).</b> 이 풀이 감당할 최대 동시 기동은
     * 15분 경계이면서 정시인 <b>09:00</b> 이다:
     * <ul>
     *   <li>5분 주기 3 — 사건 알림 묶음 flush · 사일런트 flush · 봇 집중 세션 tick(GROMO-1565)</li>
     *   <li>15분 주기 3 — 사건 알림 재훑기 · 회차 모집 · 창 종료 감지</li>
     *   <li>09:00 정시 2 — 하루형 마감 푸시 · 판돈 동결 감지</li>
     *   <li>매시 정각 1 — orphan 집중 세션 정리</li>
     * </ul>
     * 합계 9라 6으로는 세 건이 대기하지만, 대기하는 쪽이 전부 <b>알림·정리 계열</b>이고 돈 처리는
     * 아래 전용 풀에 있어 영향이 없다. 6은 상시 스레드 비용과 대기 허용 사이의 절충이다.
     * (종전 주석의 "최대 5개" 전제는 크론 수를 잘못 센 것이라 바로잡았다 — 실제로는 9다.)
     */
    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        return scheduler(6, "sched-");
    }

    /**
     * 정산 계열 전용 풀 — {@code GroupBetScheduler} 의 크론 3개(정산 스캔 · 인원 미달 무산 · 회차
     * 개설)가 <b>모두 5분 주기로 같은 시각에</b> 뜬다. 셋이 서로를 기다리지 않도록 정확히 3이다.
     * 이 크론들은 FCM 같은 외부 blocking 호출이 없어 실행이 짧고(DB 트랜잭션 단위), 늘어날 이유도
     * 알림 쪽보다 적다.
     */
    @Bean(SETTLEMENT_SCHEDULER)
    public ThreadPoolTaskScheduler settlementTaskScheduler() {
        return scheduler(3, "settle-sched-");
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

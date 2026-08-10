package com.oneorthree.phone.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

// 스케줄러 인프라 활성화 진입점 (@Scheduled 사용을 위한 설정)
@Configuration
@EnableScheduling
public class SchedulingConfig {

    /**
     * 크론 실행 풀 — <b>단일 스레드 기본값을 대체</b>한다(GROMO-1417 리뷰).
     *
     * <p>Spring 이 {@code TaskScheduler} 빈을 못 찾으면 모든 {@code @Scheduled} 가 스레드 <b>하나</b>를
     * 공유한다. 지금 크론 중에는 대상마다 blocking FCM 호출을 순차로 도는 팬아웃 발송이 여럿이라,
     * 그 하나가 늦어지면 같은 주기의 <b>정산 스캔·인원 미달 환불</b>({@code GroupBetScheduler})까지
     * 밀린다 — 알림 지연이 돈 처리 지연으로 번지는 배선이다. FCM 이 멎으면(타임아웃은
     * {@code FcmPushNotificationClient} 가 건다) 전체 크론이 무기한 멈춘다.
     *
     * <p>풀 크기 5 — 같은 분에 겹치는 크론이 최대 5개(5분·15분 주기 + 정시 잡)라 서로를 기다리지
     * 않는다. 중복 실행 방지는 스레드가 아니라 ShedLock 이 담당하므로 병렬로 돌아도 안전하다.
     */
    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(5);
        scheduler.setThreadNamePrefix("sched-");
        // 종료 시 진행 중인 크론이 끝날 시간을 준다 — 발송 도중 강제 종료되면 클레임이 PENDING 으로
        // 남고(다음 틱 회수) 최악엔 FCM 에 나간 건이 SENT 로 안 찍혀 재발송된다.
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        return scheduler;
    }
}

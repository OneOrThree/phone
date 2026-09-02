package com.oneorthree.phone.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 요청 경로에서 촉발되는 푸시 발송 전용 executor (GROMO-1089).
 *
 * <p>기존 푸시는 전부 크론({@code NotificationScheduler})이 돌려서 응답 지연이 문제되지 않았다.
 * 챌린지 개설 알림은 <b>유저 요청(POST 챌린지 생성)</b> 이 촉발점이라 사정이 다르다 —
 * {@code FcmPushNotificationClient} 는 유저 1명당 blocking HTTP 1회이고 타임아웃 설정도 없으므로,
 * 요청 스레드에서 그룹원 수만큼 순차 발송하면 (a) 응답이 그만큼 늦어지고 (b) FCM 이 멎으면
 * 챌린지 생성 응답 자체가 무한정 물린다. 생성은 이미 커밋된 뒤인데 클라이언트에는 실패로 보인다.
 *
 * <p>그래서 전용 풀로 격리한다. {@code @EnableAsync} 는 {@code common/config/AsyncConfig} 가
 * 이미 켜 두었고(GA4 전송), 여기서는 빈만 추가한다 — GA4 풀은 드롭 정책이 걸린 분석 전용이라
 * 공유하지 않는다. 두 executor 가 공존하므로 {@code @Async} 는 <b>반드시 이름을 지정</b>해야 한다.
 *
 * <p><b>친구 요청·수락 알림(GROMO-1090)도 이 풀을 쓴다.</b> 같은 문제를 각자 풀던 두 브랜치가
 * 만나면서 하나로 합쳤다(같은 관심사에 풀을 둘 두면 "내 푸시가 어느 풀에 있나"가 갈린다).
 * 친구 알림 쪽에는 격리해야 할 이유가 하나 더 있다: 그쪽 발송은 커밋 이후
 * ({@code @TransactionalEventListener(AFTER_COMMIT)}) 시작되는데, 그 시점엔 바깥 트랜잭션의 JDBC
 * 리소스가 아직 정리되기 전이라 요청 스레드에서 이어서 발송하면 발송용 트랜잭션이 <b>두 번째
 * 커넥션</b>을 요구한다 — 요청 하나가 커넥션 두 개를 물어 동시 요청이 풀 크기에 닿는 순간 서로를
 * 기다리며 멈춘다({@code FriendPushConnectionUsageTest} 가 풀 크기 1로 실증). 다른 스레드로
 * 넘기면 바깥 커넥션이 먼저 반납돼 이 교착이 성립하지 않는다.
 */
@Slf4j
@Configuration
public class NotificationAsyncConfig {

    /** 스레드 이름 접두사 — 로그에서 발송 스레드를 바로 식별하기 위한 것. */
    public static final String PUSH_EXECUTOR = "pushExecutor";

    /**
     * 코어=최대=2·큐 200. 챌린지 개설은 저빈도 이벤트고 1건당 발송 대상은 그룹 정원(최대 10명)에
     * 묶여 있어 이 크기로 충분하다. 코어와 최대를 같게 두는 이유는 GA4 풀과 같다 —
     * {@code ThreadPoolTaskExecutor} 는 큐가 가득 찬 뒤에야 코어를 넘겨 스레드를 만들기 때문에
     * 코어 1·최대 2 로 두면 두 번째 스레드가 사실상 뜨지 않는다.
     *
     * <p>큐 포화는 FCM 이 멎었다는 뜻이다. 이때 CallerRuns 로 돌리면 요청 스레드가 다시 물려
     * 애초에 격리한 의미가 없어지므로, WARN 을 남기고 드롭한다 — 개설 알림 1건 유실이
     * 챌린지 생성 API 를 마비시키는 것보다 낫다.
     *
     * @return {@code @Async(NotificationAsyncConfig.PUSH_EXECUTOR)} 로 지목해야 하는 푸시 전용 풀.
     *         GA4 풀과 공존하므로 이름을 빼면 어느 쪽이 잡힐지 보장되지 않는다
     */
    @Bean(PUSH_EXECUTOR)
    public Executor pushExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("push-");
        executor.setRejectedExecutionHandler((task, poolExecutor) ->
                log.warn("푸시 발송 큐 포화 — 작업을 드롭한다 (queue={})", poolExecutor.getQueue().size()));
        executor.initialize();
        return executor;
    }
}

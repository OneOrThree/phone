package com.oneorthree.phone.common.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * 비동기 실행 인프라 진입점 (@Async 사용을 위한 설정) — 초대 링크 GA4 전송에서 최초 도입.
 *
 * <p>GA4 Measurement Protocol 전송은 fire-and-forget 이라 호출측(참여·랜딩 응답) 흐름을 절대
 * 막으면 안 된다. 전용 executor 로 격리해 GA4 가 느려지거나 죽어도 요청 스레드가 잠기지 않게 한다.
 *
 * <p>주의: 이 클래스가 {@code Executor} 빈을 처음 등록하면서 Boot 의 자동 구성
 * {@code applicationTaskExecutor}(@ConditionalOnMissingBean(Executor.class))가 물러난다.
 * 현재 코드베이스는 MVC 비동기 반환형(Callable·DeferredResult·SseEmitter)을 쓰지 않아 영향이 없다.
 * 이후 그런 반환형을 도입한다면 여기에 별도 executor 를 명시적으로 배선할 것.
 */
@Slf4j
@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * GA4 전송 전용 executor. 코어 1·최대 2·큐 500 — 분석 이벤트는 유실돼도 서비스에 영향이 없으므로
     * 큐 포화 시 예외를 던지지 않고 WARN 로그만 남기고 드롭한다(DiscardPolicy + 로깅).
     */
    @Bean("ga4Executor")
    public Executor ga4Executor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("ga4-");
        executor.setRejectedExecutionHandler((task, poolExecutor) ->
                log.warn("GA4 전송 큐 포화 — 이벤트를 드롭한다 (queue={})", poolExecutor.getQueue().size()));
        executor.initialize();
        return executor;
    }
}

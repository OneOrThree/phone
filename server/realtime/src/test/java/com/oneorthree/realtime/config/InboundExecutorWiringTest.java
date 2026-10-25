package com.oneorthree.realtime.config;

import com.oneorthree.realtime.movement.stomp.MovementOutboundInterceptor;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.task.TaskExecutionAutoConfiguration;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.boot.websocket.autoconfigure.servlet.WebSocketMessagingAutoConfiguration;
import org.springframework.boot.micrometer.metrics.autoconfigure.task.TaskExecutorMetricsAutoConfiguration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Boot의 실행기 선택까지 포함한다. 설정 메서드만 직접 부르면 scheduler 재사용 회귀를 놓친다. */
class InboundExecutorWiringTest {

    private final WebApplicationContextRunner runner = new WebApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(TaskExecutionAutoConfiguration.class,
                    TaskExecutorMetricsAutoConfiguration.class,
                    WebSocketMessagingAutoConfiguration.class))
            .withUserConfiguration(WebSocketConfig.class)
            .withBean(MeterRegistry.class, SimpleMeterRegistry::new)
            .withBean(StompAuthChannelInterceptor.class, () -> mock(StompAuthChannelInterceptor.class))
            .withBean(ChatStompErrorHandler.class, () -> mock(ChatStompErrorHandler.class))
            .withBean(ChatOutboundChannelInterceptor.class, () -> mock(ChatOutboundChannelInterceptor.class))
            .withBean(RealtimeSessionRegistry.class, () -> mock(RealtimeSessionRegistry.class))
            .withBean(MovementSubscriptionListener.class, () -> mock(MovementSubscriptionListener.class))
            .withBean(MovementOutboundInterceptor.class, () -> mock(MovementOutboundInterceptor.class))
            .withBean(OutboundAuthzCache.class, () -> mock(OutboundAuthzCache.class))
            .withBean(OutboundSendBudget.class, () -> {
                OutboundSendBudget budget = mock(OutboundSendBudget.class);
                when(budget.newExecutor()).thenReturn(new ThreadPoolTaskExecutor());
                return budget;
            });

    @Test
    @DisplayName("Boot 4의 자동 설정에서도 수신 실행기는 heartbeat 및 송신 실행기와 분리된다")
    void inboundExecutorIsIndependentFromHeartbeatAndOutbound() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            Object inbound = context.getBean("clientInboundChannelExecutor");
            ThreadPoolTaskScheduler heartbeat = context.getBean("realtimeHeartbeatScheduler",
                    ThreadPoolTaskScheduler.class);
            assertThat(inbound).isNotSameAs(heartbeat)
                    .isNotSameAs(context.getBean("clientOutboundChannelExecutor"));
            assertThat(inbound).isInstanceOf(ThreadPoolTaskExecutor.class);
            ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) inbound;
            assertThat(executor.getCorePoolSize()).isEqualTo(4);
            assertThat(executor.getMaxPoolSize()).isEqualTo(4);
            assertThat(executor.getQueueCapacity()).isEqualTo(256);
            assertThat(executor.getThreadNamePrefix()).isEqualTo("realtime-inbound-");
            assertThat(heartbeat.getScheduledThreadPoolExecutor().getCorePoolSize()).isEqualTo(1);
            MeterRegistry metrics = context.getBean(MeterRegistry.class);
            assertThat(metrics.get("executor.pool.core").tag("name", "realtime-inbound")
                    .gauge().value()).isEqualTo(4);
            assertThat(metrics.get("executor.pool.core").tag("name", "realtimeHeartbeatScheduler")
                    .gauge().value()).isEqualTo(1);
            assertThat(metrics.get("realtime.inbound.caller.runs").counter().count()).isZero();
        });
    }

    @Test
    @DisplayName("수신 스레드가 모두 막혀도 heartbeat 예약 작업은 독립적으로 실행된다")
    void blockedInboundWorkersDoNotDelayHeartbeat() {
        runner.run(context -> {
            ThreadPoolTaskExecutor executor = context.getBean("clientInboundChannelExecutor",
                    ThreadPoolTaskExecutor.class);
            ThreadPoolTaskScheduler heartbeat = context.getBean("realtimeHeartbeatScheduler",
                    ThreadPoolTaskScheduler.class);
            CountDownLatch started = new CountDownLatch(4);
            CountDownLatch release = new CountDownLatch(1);
            CountDownLatch beat = new CountDownLatch(1);
            List<String> workers = new CopyOnWriteArrayList<>();
            try {
                for (int index = 0; index < 4; index++) {
                    executor.execute(() -> {
                        workers.add(Thread.currentThread().getName());
                        started.countDown();
                        try {
                            release.await(5, TimeUnit.SECONDS);
                        } catch (InterruptedException ex) {
                            Thread.currentThread().interrupt();
                        }
                    });
                }
                assertThat(started.await(3, TimeUnit.SECONDS)).isTrue();
                assertThat(workers).hasSize(4).allMatch(name -> name.startsWith("realtime-inbound-"));
                heartbeat.schedule(beat::countDown, Instant.now());
                assertThat(beat.await(1, TimeUnit.SECONDS)).isTrue();
            } finally {
                release.countDown();
            }
        });
    }

    @Test
    @DisplayName("음수 큐는 무한 대기로 해석하지 않고 기동 시 거절한다")
    void unboundedQueueConfigurationFailsAtStartup() {
        runner.withPropertyValues("chat.websocket.inbound.queue-capacity=-1")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    @DisplayName("처리 스레드가 없는 설정은 기동 시 거절한다")
    void noWorkerConfigurationFailsAtStartup() {
        runner.withPropertyValues("chat.websocket.inbound.threads=0")
                .run(context -> assertThat(context).hasFailed());
    }
}

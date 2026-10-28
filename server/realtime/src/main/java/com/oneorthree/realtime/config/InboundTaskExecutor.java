package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.jvm.ExecutorServiceMetrics;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.util.Assert;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadFactory;

/** 수신 실행기의 스레드·큐 예산과 관측. 초기화·종료는 Spring 채널 빈의 수명주기를 따른다. */
final class InboundTaskExecutor extends ThreadPoolTaskExecutor {

    private static final long serialVersionUID = 1L;

    private final transient MeterRegistry registry;

    InboundTaskExecutor(int threads, int queueCapacity, MeterRegistry registry) {
        Assert.state(threads > 0, "chat.websocket.inbound.threads must be positive");
        Assert.state(queueCapacity >= 0, "chat.websocket.inbound.queue-capacity must not be negative");
        this.registry = registry;
        setThreadNamePrefix("realtime-inbound-");
        setCorePoolSize(threads);
        setMaxPoolSize(threads);
        setQueueCapacity(queueCapacity);
        setRejectedExecutionHandler(new InboundCallerRunsPolicy(Counter.builder("realtime.inbound.caller.runs")
                .description("수신 실행기 포화 또는 종료로 제출 스레드에서 처리한 작업 수").register(registry)));
    }

    @Override
    protected ExecutorService initializeExecutor(ThreadFactory threadFactory,
            RejectedExecutionHandler rejectedExecutionHandler) {
        ExecutorService service = super.initializeExecutor(threadFactory, rejectedExecutionHandler);
        // Spring의 빈 선언 타입은 Executor다. 자동 지표가 초기화 순서에 따라 놓치므로 여기서 반드시 등록한다.
        new ExecutorServiceMetrics(service, "realtime-inbound", List.of()).bindTo(registry);
        return service;
    }
}

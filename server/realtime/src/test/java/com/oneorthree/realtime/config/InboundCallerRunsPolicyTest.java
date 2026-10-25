package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.apache.commons.logging.LogFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.broker.OrderedMessageChannelDecorator;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.messaging.support.MessageBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InboundCallerRunsPolicyTest {

    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();

    private InboundCallerRunsPolicy policy() {
        return new InboundCallerRunsPolicy(metrics.counter("realtime.inbound.caller.runs"));
    }

    @Test
    @DisplayName("포화 중 순서 보존 채널의 긴 버스트도 재귀·유실·중복 없이 처리한다")
    void saturatedOrderedBurstDoesNotExhaustStackOrLoseMessages() throws Exception {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(1), policy());
        CountDownLatch workerStarted = new CountDownLatch(1);
        CountDownLatch workerRelease = new CountDownLatch(1);
        CountDownLatch firstHandled = new CountDownLatch(1);
        CountDownLatch firstRelease = new CountDownLatch(1);
        var sender = Executors.newSingleThreadExecutor();
        try {
            pool.execute(() -> { workerStarted.countDown(); await(workerRelease); });
            assertThat(workerStarted.await(3, TimeUnit.SECONDS)).isTrue();
            pool.execute(() -> { });
            ExecutorSubscribableChannel channel = new ExecutorSubscribableChannel(pool);
            OrderedMessageChannelDecorator.configureInterceptor(channel, true);
            List<Integer> received = new ArrayList<>();
            channel.subscribe(message -> {
                int value = (Integer) message.getPayload();
                if (value == 0) {
                    firstHandled.countDown();
                    await(firstRelease);
                }
                received.add(value);
            });
            OrderedMessageChannelDecorator ordered = new OrderedMessageChannelDecorator(channel,
                    LogFactory.getLog(getClass()));
            var submitted = sender.submit(() -> ordered.send(message(0)));
            assertThat(firstHandled.await(3, TimeUnit.SECONDS)).isTrue();
            for (int index = 1; index < 10_000; index++) {
                ordered.send(message(index));
            }
            assertThat(pool.getQueue()).hasSize(1);
            firstRelease.countDown();
            assertThat(submitted.get(10, TimeUnit.SECONDS)).isTrue();
            assertThat(received).containsExactlyElementsOf(IntStream.range(0, 10_000).boxed().toList());
            assertThat(metrics.get("realtime.inbound.caller.runs").counter().count()).isEqualTo(10_000);
        } finally {
            firstRelease.countDown();
            workerRelease.countDown();
            sender.shutdownNow();
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("재진입 작업을 예약한 처리기가 실패해도 후속 작업을 마치고 최초 오류를 돌려준다")
    void failureStillDrainsAcceptedTasksAndClearsThreadLocal() {
        InboundCallerRunsPolicy policy = policy();
        List<Integer> received = new ArrayList<>();
        IllegalStateException failure = new IllegalStateException("handler failed");
        IllegalArgumentException later = new IllegalArgumentException("later handler failed");
        assertThatThrownBy(() -> policy.rejectedExecution(() -> {
            policy.rejectedExecution(() -> received.add(1), null);
            policy.rejectedExecution(() -> {
                throw later;
            }, null);
            throw failure;
        }, null)).isSameAs(failure);
        assertThat(failure.getSuppressed()).as("뒤 오류도 버리지 않는다").containsExactly(later);
        policy.rejectedExecution(() -> received.add(2), null);
        assertThat(received).containsExactly(1, 2);
    }

    @Test
    @DisplayName("종료 중 수신 DISCONNECT도 Spring 기본 동작처럼 제출 스레드에서 처리한다")
    void shutdownDoesNotSilentlyDiscardDisconnect() {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(1), policy());
        pool.shutdown();
        List<Thread> received = new ArrayList<>();
        pool.execute(() -> received.add(Thread.currentThread()));
        assertThat(received).containsExactly(Thread.currentThread());
    }

    private static Message<Integer> message(int value) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId("same-session");
        headers.setLeaveMutable(true);
        return MessageBuilder.createMessage(value, headers.getMessageHeaders());
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) {
                throw new AssertionError("latch timeout");
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new AssertionError(ex);
        }
    }
}

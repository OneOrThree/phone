package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import org.apache.commons.logging.LogFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.broker.OrderedMessageChannelDecorator;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP 수신 프레임별 로그 문맥 (GROMO-2559) — 운영과 같은 순서 보존 배선(실제 {@link ExecutorSubscribableChannel} +
 * {@link OrderedMessageChannelDecorator} + Spring 의 순서 콜백, 실행 스레드 1개)으로 본다.
 */
class StompLogScopeTest {

    @Test
    @DisplayName("프레임마다 새 request_id·주체 user_id 가 실행 스레드에 깔리고, 순서 콜백이 같은 스레드로 보낸 다음 프레임의 preSend 는 앞 값을 달지 않는다")
    void eachFrameHasItsOwnRequestIdAndTheNextPreSendDoesNotInheritIt() throws Exception {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setThreadNamePrefix("inbound-test-");
        executor.initialize();
        try {
            ExecutorSubscribableChannel inbound = new ExecutorSubscribableChannel(executor);
            List<String> gateRequestIds = new CopyOnWriteArrayList<>();
            List<String> handleRequestIds = new CopyOnWriteArrayList<>();
            List<String> handleUsers = new CopyOnWriteArrayList<>();
            // 관문(preSend)과 처리 직전(beforeHandle)에서 MDC 를 본다 — 종전 인터셉터 자리.
            ExecutorChannelInterceptor gate = new ExecutorChannelInterceptor() {
                @Override
                public Message<?> preSend(Message<?> message, MessageChannel channel) {
                    gateRequestIds.add(Objects.toString(MDC.get("request_id"), "none"));
                    return message;
                }

                @Override
                public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
                    handleRequestIds.add(Objects.toString(MDC.get("request_id"), "none"));
                    handleUsers.add(Objects.toString(MDC.get("user_id"), "none"));
                    return message;
                }
            };
            inbound.setInterceptors(List.of(new StompLogScope(), gate));
            // 운영과 같은 순서 — 채널 빈을 만든 «뒤» Spring 이 콜백을 붙인다(WebSocketMessageBrokerConfigurationSupport).
            OrderedMessageChannelDecorator.configureInterceptor(inbound, true);
            CountDownLatch release = new CountDownLatch(1);
            CountDownLatch handled = new CountDownLatch(2);
            inbound.subscribe(message -> {
                try {
                    release.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                handled.countDown();
            });
            UUID user = UUID.randomUUID();
            OrderedMessageChannelDecorator session = new OrderedMessageChannelDecorator(inbound,
                    LogFactory.getLog(StompLogScopeTest.class));

            session.send(frame(user));
            session.send(frame(user)); // 앞 프레임이 끝난 뒤 콜백이 실행 스레드에서 보낸다
            release.countDown();

            assertThat(handled.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(gateRequestIds).as("두 프레임의 관문 — 둘째는 실행 스레드에서 앞 프레임 처리 중에 불린다")
                    .containsExactly("none", "none");
            assertThat(handleRequestIds).hasSize(2).doesNotContain("none").doesNotHaveDuplicates();
            assertThat(UUID.fromString(handleRequestIds.get(0))).isNotNull();
            assertThat(handleUsers).containsExactly(user.toString(), user.toString());
            String leftover = CompletableFuture.supplyAsync(() -> Objects.toString(MDC.get("request_id"), "none")
                    + "/" + Objects.toString(MDC.get("user_id"), "none"), executor).get(5, TimeUnit.SECONDS);
            assertThat(leftover).as("같은 실행 스레드의 다음 작업엔 남지 않는다").isEqualTo("none/none");
        } finally {
            executor.shutdown();
        }
    }

    private static Message<byte[]> frame(UUID user) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId("s-1");
        headers.setUser(new ChatPrincipal(user, "Bearer x"));
        headers.setLeaveMutable(true); // 순서 보존 데코레이터가 다음 프레임 콜백을 헤더에 단다
        return MessageBuilder.createMessage("{}".getBytes(StandardCharsets.UTF_8), headers.getMessageHeaders());
    }
}

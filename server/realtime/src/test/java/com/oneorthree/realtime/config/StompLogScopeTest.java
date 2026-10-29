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
 * STOMP 수신 프레임별 로그 문맥 (GROMO-2559·2581) — 운영과 같은 순서 보존 배선(실제 {@link ExecutorSubscribableChannel} +
 * {@link OrderedMessageChannelDecorator} + Spring 의 순서 콜백, 실행 스레드 1개)으로 본다.
 */
class StompLogScopeTest {

    @Test
    @DisplayName("프레임마다 새 request_id·주체 user_id 가 관문(preSend)과 처리 스레드에 같은 값으로 깔리고, 순서 콜백이 같은 스레드로 보낸 다음 프레임의 관문은 앞 값을 달지 않는다")
    void eachFrameHasItsOwnRequestIdAndTheNextPreSendDoesNotInheritIt() throws Exception {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setThreadNamePrefix("inbound-test-");
        executor.initialize();
        try {
            ExecutorSubscribableChannel inbound = new ExecutorSubscribableChannel(executor);
            List<String> gateRequestIds = new CopyOnWriteArrayList<>();
            List<String> gateUsers = new CopyOnWriteArrayList<>();
            List<String> handleRequestIds = new CopyOnWriteArrayList<>();
            List<String> handleUsers = new CopyOnWriteArrayList<>();
            // 관문(preSend)과 처리 직전(beforeHandle)에서 MDC 를 본다 — 종전 인터셉터 자리.
            ExecutorChannelInterceptor gate = new ExecutorChannelInterceptor() {
                @Override
                public Message<?> preSend(Message<?> message, MessageChannel channel) {
                    gateRequestIds.add(Objects.toString(MDC.get("request_id"), "none"));
                    gateUsers.add(Objects.toString(MDC.get("user_id"), "none"));
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
            // 둘째 프레임의 관문은 앞 프레임 처리가 끝난 뒤 그 실행 스레드에서 순서 콜백이 부른다 — 앞 값을 물려받지 않는다.
            assertThat(gateRequestIds).as("관문 거절 로그도 그 프레임의 request_id 를 단다(GROMO-2581)")
                    .hasSize(2).doesNotContain("none").doesNotHaveDuplicates();
            assertThat(UUID.fromString(gateRequestIds.get(0))).isNotNull();
            assertThat(handleRequestIds).as("한 프레임은 관문과 처리가 같은 값").isEqualTo(gateRequestIds);
            assertThat(gateUsers).containsExactly(user.toString(), user.toString());
            assertThat(handleUsers).containsExactly(user.toString(), user.toString());
            String leftover = CompletableFuture.supplyAsync(() -> Objects.toString(MDC.get("request_id"), "none")
                    + "/" + Objects.toString(MDC.get("user_id"), "none"), executor).get(5, TimeUnit.SECONDS);
            assertThat(leftover).as("같은 실행 스레드의 다음 작업엔 남지 않는다").isEqualTo("none/none");
        } finally {
            executor.shutdown();
        }
    }

    @Test
    @DisplayName("주체 없는 관문(CONNECT)엔 바깥 스레드의 user_id 가 보이지 않고, 헤더를 못 다는 불변 프레임은 처리 단계가 새 값을 만든다 — 닫으면 바깥 값 그대로")
    void connectGateHidesTheOuterUserAndImmutableFramesStillGetAnId() {
        StompLogScope scope = new StompLogScope();
        MDC.put("request_id", "outer-req");
        MDC.put("user_id", "outer-user");
        try {
            SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.CONNECT);
            Message<byte[]> connect = MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());

            scope.preSend(connect, null);
            String gate = MDC.get("request_id");
            assertThat(MDC.get("user_id")).isNull();
            scope.beforeHandle(connect, null, null);
            String handle = MDC.get("request_id");
            scope.afterMessageHandled(connect, null, null, null);
            scope.afterSendCompletion(connect, null, true, null);

            assertThat(UUID.fromString(gate)).isNotNull();
            assertThat(UUID.fromString(handle)).as("불변 헤더 — 관문 값을 못 넘겨 새로 만든다").isNotEqualTo(UUID.fromString(gate));
            assertThat(MDC.get("request_id")).isEqualTo("outer-req");
            assertThat(MDC.get("user_id")).isEqualTo("outer-user");
        } finally {
            MDC.clear();
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

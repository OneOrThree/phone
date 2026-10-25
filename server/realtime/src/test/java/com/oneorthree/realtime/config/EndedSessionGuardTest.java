package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.apache.commons.logging.LogFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.broker.OrderedMessageChannelDecorator;
import org.springframework.messaging.simp.broker.SimpleBrokerMessageHandler;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 수신 실행기·순서 보존 데코레이터·SimpleBroker 로 포화 중 종료를 재현한다. */
class EndedSessionGuardTest {

    private static final String SESSION = "socket-1";

    @Test
    @DisplayName("포화 중 종료 DISCONNECT 가 대기 CONNECT 를 추월해도 끝난 세션은 브로커·구독 레지스트리에 남지 않는다")
    void lateConnectAfterSaturatedCloseDoesNotResurrectBrokerSession() throws Exception {
        SimpleMeterRegistry metrics = new SimpleMeterRegistry();
        InboundTaskExecutor executor = new InboundTaskExecutor(1, 1, metrics);
        executor.initialize();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            ExecutorSubscribableChannel inbound = new ExecutorSubscribableChannel(executor);
            // 운영 배선 순서 — 등록 가로채기가 먼저, Spring 의 순서 보존 콜백은 엔드포인트 등록 때 뒤에 붙는다.
            inbound.setInterceptors(List.of(new EndedSessionGuard()));
            OrderedMessageChannelDecorator.configureInterceptor(inbound, true);
            List<Message<?>> toClient = new CopyOnWriteArrayList<>();
            ExecutorSubscribableChannel outbound = new ExecutorSubscribableChannel();
            outbound.subscribe(toClient::add);
            SimpleBrokerMessageHandler broker = new SimpleBrokerMessageHandler(inbound, outbound,
                    new ExecutorSubscribableChannel(), List.of("/topic"));
            broker.start();

            executor.execute(() -> await(started, release));
            assertThat(started.await(3, TimeUnit.SECONDS)).as("수신 워커를 막는다").isTrue();
            Map<String, Object> socketAttributes = new ConcurrentHashMap<>();
            OrderedMessageChannelDecorator session = new OrderedMessageChannelDecorator(inbound,
                    LogFactory.getLog(getClass()));
            session.send(frame(SimpMessageType.CONNECT, socketAttributes));
            session.send(frame(SimpMessageType.SUBSCRIBE, socketAttributes));
            ThreadPoolExecutor pool = executor.getThreadPoolExecutor();
            assertThat(pool.getQueue()).as("CONNECT 가 실행기 큐를 채운다").hasSize(1);

            // 소켓 종료 — Spring 은 DISCONNECT 를 세션 순서 큐 밖에서 보낸다. 큐가 차 있어 이 스레드에서 먼저 돈다.
            inbound.send(frame(SimpMessageType.DISCONNECT, socketAttributes));
            assertThat(metrics.get("realtime.inbound.caller.runs").counter().count()).isEqualTo(1);
            assertThat(pool.getQueue()).as("CONNECT 는 아직 대기 중 — 종료가 추월했다").hasSize(1);

            release.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

            @SuppressWarnings("unchecked")
            Map<String, ?> brokerSessions = (Map<String, ?>) ReflectionTestUtils.getField(broker, "sessions");
            assertThat(brokerSessions).as("닫힌 세션이 브로커에 다시 등록되지 않는다").doesNotContainKey(SESSION);
            assertThat(broker.getSubscriptionRegistry().findSubscriptions(frame(SimpMessageType.MESSAGE,
                    socketAttributes))).as("늦은 SUBSCRIBE 도 남지 않는다").isEmpty();
            assertThat(toClient).noneMatch(message -> SimpMessageType.CONNECT_ACK.equals(
                    SimpMessageHeaderAccessor.getMessageType(message.getHeaders())));
        } finally {
            release.countDown();
            executor.shutdown();
        }
    }

    private static Message<byte[]> frame(SimpMessageType type, Map<String, Object> socketAttributes) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(type);
        headers.setSessionId(SESSION);
        headers.setSessionAttributes(socketAttributes);
        headers.setHeader(SimpMessageHeaderAccessor.HEART_BEAT_HEADER, new long[] {0, 0});
        if (type == SimpMessageType.SUBSCRIBE || type == SimpMessageType.MESSAGE) {
            headers.setDestination("/topic/probe");
            headers.setSubscriptionId("sub-1");
        }
        headers.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());
    }

    private static void await(CountDownLatch started, CountDownLatch release) {
        started.countDown();
        try {
            release.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }
}

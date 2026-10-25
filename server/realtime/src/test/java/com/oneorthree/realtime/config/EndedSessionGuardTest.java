package com.oneorthree.realtime.config;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.apache.commons.logging.LogFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.broker.OrderedMessageChannelDecorator;
import org.springframework.messaging.simp.broker.SimpleBrokerMessageHandler;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.simp.user.DefaultUserDestinationResolver;
import org.springframework.messaging.simp.user.UserDestinationMessageHandler;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.ExecutorChannelInterceptor;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.messaging.DefaultSimpUserRegistry;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실제 수신 실행기·순서 보존 데코레이터·SimpleBroker·사용자 목적지 처리기로 종료와 늦은 프레임의 경합을 재현한다.
 * 소켓 종료는 운영과 같이 «표시({@link EndedSessionGuard#markEnded}, SessionDisconnectEvent 자리) → 종료 DISCONNECT» 순이다.
 */
class EndedSessionGuardTest {

    private static final String SESSION = "socket-1";
    private static final String USER_ERRORS = "/queue/errors-user" + SESSION;

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
            EndedSessionGuard.markEnded(socketAttributes);
            inbound.send(frame(SimpMessageType.DISCONNECT, socketAttributes));
            assertThat(metrics.get("realtime.inbound.caller.runs").counter().count()).isEqualTo(1);
            assertThat(pool.getQueue()).as("CONNECT 는 아직 대기 중 — 종료가 추월했다").hasSize(1);

            release.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

            assertThat(brokerSessions(broker)).as("닫힌 세션이 브로커에 다시 등록되지 않는다").doesNotContainKey(SESSION);
            assertThat(subscribers(broker, "/topic/probe")).as("늦은 SUBSCRIBE 도 남지 않는다").isEmpty();
            assertThat(toClient).noneMatch(message -> typeOf(message) == SimpMessageType.CONNECT_ACK);
        } finally {
            release.countDown();
            executor.shutdown();
        }
    }

    @Test
    @DisplayName("가드를 이미 지난 CONNECT 가 종료 DISCONNECT 뒤에 브로커에 등록돼도 보상이 그 세션을 지운다")
    void connectPastGuardThatRegistersAfterDisconnectIsCompensated() throws Exception {
        InboundTaskExecutor executor = new InboundTaskExecutor(2, 1, new SimpleMeterRegistry());
        executor.initialize();
        CountDownLatch connectPastGuard = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch disconnectAcked = new CountDownLatch(1);
        try {
            ExecutorSubscribableChannel inbound = new ExecutorSubscribableChannel(executor);
            // 가드 «뒤»에서 CONNECT 를 멈춘다 — 가드 검사는 통과했고 브로커 처리는 아직이다.
            ExecutorChannelInterceptor pauseConnect = new ExecutorChannelInterceptor() {
                @Override
                public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
                    if (typeOf(message) == SimpMessageType.CONNECT) {
                        await(connectPastGuard, release);
                    }
                    return message;
                }
            };
            inbound.setInterceptors(List.of(new EndedSessionGuard(), pauseConnect));
            OrderedMessageChannelDecorator.configureInterceptor(inbound, true);
            List<Message<?>> toClient = new CopyOnWriteArrayList<>();
            ExecutorSubscribableChannel outbound = new ExecutorSubscribableChannel();
            outbound.subscribe(message -> {
                toClient.add(message);
                if (typeOf(message) == SimpMessageType.DISCONNECT_ACK) {
                    disconnectAcked.countDown();
                }
            });
            SimpleBrokerMessageHandler broker = new SimpleBrokerMessageHandler(inbound, outbound,
                    new ExecutorSubscribableChannel(), List.of("/topic"));
            broker.start();

            Map<String, Object> socketAttributes = new ConcurrentHashMap<>();
            OrderedMessageChannelDecorator session = new OrderedMessageChannelDecorator(inbound,
                    LogFactory.getLog(getClass()));
            session.send(frame(SimpMessageType.CONNECT, socketAttributes));
            session.send(frame(SimpMessageType.SUBSCRIBE, socketAttributes));
            assertThat(connectPastGuard.await(3, TimeUnit.SECONDS)).as("CONNECT 가 가드를 지났다").isTrue();

            // 소켓 종료 — 다른 워커가 종료 DISCONNECT 를 끝까지 처리한다. 브로커에는 아직 그 세션이 없다.
            EndedSessionGuard.markEnded(socketAttributes);
            inbound.send(frame(SimpMessageType.DISCONNECT, socketAttributes));
            assertThat(disconnectAcked.await(3, TimeUnit.SECONDS)).as("종료 DISCONNECT 처리 완료").isTrue();
            assertThat(brokerSessions(broker)).doesNotContainKey(SESSION);

            release.countDown();
            ThreadPoolExecutor pool = executor.getThreadPoolExecutor();
            pool.shutdown();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

            assertThat(toClient).as("늦은 CONNECT 는 실제로 브로커에 등록됐었다")
                    .anyMatch(message -> typeOf(message) == SimpMessageType.CONNECT_ACK);
            assertThat(brokerSessions(broker)).as("보상이 되살아난 세션을 지운다").doesNotContainKey(SESSION);
            assertThat(subscribers(broker, "/topic/probe")).isEmpty();
        } finally {
            release.countDown();
            executor.shutdown();
        }
    }

    @Test
    @DisplayName("클라이언트가 보낸 DISCONNECT(receipt) 는 끝난 세션 표시를 남기지 않아 receipt 를 단 ACK 하나만 나간다")
    void clientDisconnectWithReceiptIsNotTreatedAsSocketClose() throws Exception {
        InboundTaskExecutor executor = new InboundTaskExecutor(1, 8, new SimpleMeterRegistry());
        executor.initialize();
        try {
            ExecutorSubscribableChannel inbound = new ExecutorSubscribableChannel(executor);
            inbound.setInterceptors(List.of(new EndedSessionGuard()));
            OrderedMessageChannelDecorator.configureInterceptor(inbound, true);
            List<Message<?>> toClient = new CopyOnWriteArrayList<>();
            ExecutorSubscribableChannel outbound = new ExecutorSubscribableChannel();
            outbound.subscribe(toClient::add);
            SimpleBrokerMessageHandler broker = new SimpleBrokerMessageHandler(inbound, outbound,
                    new ExecutorSubscribableChannel(), List.of("/topic"));
            broker.start();

            Map<String, Object> socketAttributes = new ConcurrentHashMap<>();
            OrderedMessageChannelDecorator session = new OrderedMessageChannelDecorator(inbound,
                    LogFactory.getLog(getClass()));
            session.send(frame(SimpMessageType.SUBSCRIBE, socketAttributes));
            session.send(clientDisconnect(socketAttributes, "r1"));
            ThreadPoolExecutor pool = executor.getThreadPoolExecutor();
            pool.shutdown();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

            List<Message<?>> acks = toClient.stream()
                    .filter(message -> typeOf(message) == SimpMessageType.DISCONNECT_ACK).toList();
            assertThat(acks).as("합성 ACK 없이 원본 DISCONNECT 의 ACK 하나").hasSize(1);
            Message<?> original = (Message<?>) acks.get(0).getHeaders()
                    .get(SimpMessageHeaderAccessor.DISCONNECT_MESSAGE_HEADER);
            assertThat(StompHeaderAccessor.wrap(original).getReceipt()).isEqualTo("r1");
            assertThat(socketAttributes).doesNotContainKey(EndedSessionGuard.ENDED);
        } finally {
            executor.shutdown();
        }
    }

    @Test
    @DisplayName("가드를 지난 /user/queue/errors SUBSCRIBE 가 종료 뒤 처리돼도 브로커 구독·전송 템플릿이 남지 않는다")
    void lateUserDestinationSubscribeDoesNotLeaveBrokerSubscription() throws Exception {
        InboundTaskExecutor executor = new InboundTaskExecutor(2, 4, new SimpleMeterRegistry());
        executor.initialize();
        CountDownLatch subscribePastGuard = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch disconnectHandled = new CountDownLatch(2);
        AtomicInteger forwarded = new AtomicInteger();
        try {
            ExecutorSubscribableChannel inbound = new ExecutorSubscribableChannel(executor);
            // 가드 «뒤»에서 사용자 목적지 처리기의 SUBSCRIBE 를 멈추고, 종료 DISCONNECT 가 두 처리기에서 끝나는 것을 센다.
            ExecutorChannelInterceptor probe = new ExecutorChannelInterceptor() {
                @Override
                public Message<?> beforeHandle(Message<?> message, MessageChannel channel, MessageHandler handler) {
                    if (handler instanceof UserDestinationMessageHandler
                            && typeOf(message) == SimpMessageType.SUBSCRIBE) {
                        await(subscribePastGuard, release);
                    }
                    return message;
                }

                @Override
                public void afterMessageHandled(Message<?> message, MessageChannel channel, MessageHandler handler,
                        Exception ex) {
                    if (typeOf(message) == SimpMessageType.DISCONNECT) {
                        disconnectHandled.countDown();
                    }
                }
            };
            inbound.setInterceptors(List.of(new EndedSessionGuard(), probe));
            OrderedMessageChannelDecorator.configureInterceptor(inbound, true);
            ExecutorSubscribableChannel brokerChannel = new ExecutorSubscribableChannel();
            ChannelInterceptor countForwarded = new ChannelInterceptor() {
                @Override
                public Message<?> preSend(Message<?> message, MessageChannel channel) {
                    if (USER_ERRORS.equals(SimpMessageHeaderAccessor.getDestination(message.getHeaders()))) {
                        forwarded.incrementAndGet();
                    }
                    return message;
                }
            };
            brokerChannel.setInterceptors(List.of(countForwarded, new EndedSessionGuard()));
            ExecutorSubscribableChannel outbound = new ExecutorSubscribableChannel();
            outbound.subscribe(message -> { });
            SimpleBrokerMessageHandler broker = new SimpleBrokerMessageHandler(inbound, outbound, brokerChannel,
                    List.of("/topic", "/queue"));
            broker.start();
            UserDestinationMessageHandler userDestinations = new UserDestinationMessageHandler(inbound,
                    brokerChannel, new DefaultUserDestinationResolver(new DefaultSimpUserRegistry()));
            userDestinations.start();

            Map<String, Object> socketAttributes = new ConcurrentHashMap<>();
            OrderedMessageChannelDecorator session = new OrderedMessageChannelDecorator(inbound,
                    LogFactory.getLog(getClass()));
            session.send(frame(SimpMessageType.SUBSCRIBE, "/user/queue/errors", socketAttributes));
            assertThat(subscribePastGuard.await(3, TimeUnit.SECONDS)).as("SUBSCRIBE 가 가드를 지났다").isTrue();

            EndedSessionGuard.markEnded(socketAttributes);
            inbound.send(frame(SimpMessageType.DISCONNECT, socketAttributes));
            assertThat(disconnectHandled.await(3, TimeUnit.SECONDS)).as("두 처리기에서 종료 처리 완료").isTrue();

            release.countDown();
            ThreadPoolExecutor pool = executor.getThreadPoolExecutor();
            pool.shutdown();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

            assertThat(forwarded).as("늦은 SUBSCRIBE 는 실제로 브로커 채널로 다시 보내졌다").hasValue(1);
            assertThat(subscribers(broker, USER_ERRORS)).as("브로커 구독이 남지 않는다").isEmpty();
            Object sendHelper = ReflectionTestUtils.getField(userDestinations, "sendHelper");
            Map<?, ?> templates = (Map<?, ?>) ReflectionTestUtils.getField(sendHelper, "orderedMessagingTemplates");
            assertThat(templates.containsKey(SESSION)).as("세션별 전송 템플릿도 보상이 지운다").isFalse();
        } finally {
            release.countDown();
            executor.shutdown();
        }
    }

    @Test
    @DisplayName("앱이 SimpMessagingTemplate 으로 보내는 메시지는 세션 속성이 없어 가드를 그대로 지난다")
    void templateMessagesPassTheGuard() {
        ExecutorSubscribableChannel brokerChannel = new ExecutorSubscribableChannel();
        brokerChannel.setInterceptors(List.of(new EndedSessionGuard()));
        List<Message<?>> received = new CopyOnWriteArrayList<>();
        brokerChannel.subscribe(received::add);

        new SimpMessagingTemplate(brokerChannel).convertAndSend("/topic/probe", "hello");

        assertThat(received).hasSize(1);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, ?> brokerSessions(SimpleBrokerMessageHandler broker) {
        return (Map<String, ?>) ReflectionTestUtils.getField(broker, "sessions");
    }

    private static Map<String, List<String>> subscribers(SimpleBrokerMessageHandler broker, String destination) {
        return broker.getSubscriptionRegistry().findSubscriptions(
                frame(SimpMessageType.MESSAGE, destination, new ConcurrentHashMap<>()));
    }

    private static SimpMessageType typeOf(Message<?> message) {
        return SimpMessageHeaderAccessor.getMessageType(message.getHeaders());
    }

    private static Message<byte[]> frame(SimpMessageType type, Map<String, Object> socketAttributes) {
        return frame(type, "/topic/probe", socketAttributes);
    }

    private static Message<byte[]> frame(SimpMessageType type, String destination,
            Map<String, Object> socketAttributes) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(type);
        headers.setSessionId(SESSION);
        headers.setSessionAttributes(socketAttributes);
        headers.setHeader(SimpMessageHeaderAccessor.HEART_BEAT_HEADER, new long[] {0, 0});
        if (type == SimpMessageType.SUBSCRIBE || type == SimpMessageType.MESSAGE) {
            headers.setDestination(destination);
            headers.setSubscriptionId("sub-1");
        }
        headers.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());
    }

    private static Message<byte[]> clientDisconnect(Map<String, Object> socketAttributes, String receipt) {
        StompHeaderAccessor headers = StompHeaderAccessor.create(StompCommand.DISCONNECT);
        headers.setSessionId(SESSION);
        headers.setSessionAttributes(socketAttributes);
        headers.setReceipt(receipt);
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

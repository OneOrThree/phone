package com.oneorthree.realtime.config;

import com.oneorthree.realtime.movement.stomp.MovementOutboundInterceptor;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.SubscribableChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 인터셉터 «순서»가 곧 계약인 두 자리(GROMO-2247) — 순서가 뒤집혀도 컴파일·기동은 되고 조용히 틀린다.
 * <ul>
 *   <li>인바운드: 관문({@code RejectAsErrorFrame}) 뒤에 이동 구독 처리 — 앞에 서면 거절될 SUBSCRIBE 로도 입장한다.</li>
 *   <li>아웃바운드: 이동 완료 통지가 채팅 검사보다 앞 — 뒤에 서면 채팅 쪽이 버린 이동 프레임의 완료가 영영 안 온다.</li>
 * </ul>
 */
class WebSocketConfigTest {

    private final ChatOutboundChannelInterceptor chatOutbound = mock(ChatOutboundChannelInterceptor.class);
    private final RealtimeSessionRegistry sessions = mock(RealtimeSessionRegistry.class);
    private final MovementSubscriptionListener movementSubscriptions = mock(MovementSubscriptionListener.class);
    private final MovementOutboundInterceptor movementOutbound = mock(MovementOutboundInterceptor.class);
    private final OutboundSendBudget budget = mock(OutboundSendBudget.class);
    private final OutboundAuthzCache authzCache = mock(OutboundAuthzCache.class);
    private final WebSocketConfig config = new WebSocketConfig(mock(StompAuthChannelInterceptor.class),
            mock(ChatStompErrorHandler.class), chatOutbound, sessions, movementSubscriptions, movementOutbound, budget,
            authzCache, new SimpleMeterRegistry());

    @Test
    @DisplayName("인바운드는 로그 문맥 → 끝난 세션 가드 → 관문 → 이동 구독 처리, 아웃바운드는 이동 완료 통지 → 채팅 검사 → 송신 측정 순이다")
    void interceptorOrderIsTheContract() {
        Interceptors inbound = new Interceptors();
        ReflectionTestUtils.setField(config, "inboundThreads", 4);
        ReflectionTestUtils.setField(config, "inboundQueueCapacity", 256);
        config.configureClientInboundChannel(inbound);
        assertThat(inbound.list()).hasSize(4);
        // 로그 문맥(GROMO-2559)은 맨 앞이지만 프레임을 버리지 않는다 — 종전 셋의 순서·거절은 그대로다.
        assertThat(inbound.list().get(0)).isInstanceOf(StompLogScope.class);
        assertThat(inbound.list().get(1)).isInstanceOf(EndedSessionGuard.class);
        assertThat(inbound.list().get(2).getClass().getSimpleName()).isEqualTo("RejectAsErrorFrame");
        assertThat(inbound.list().get(3)).isSameAs(movementSubscriptions);

        // 브로커 채널에도 같은 가드 — 사용자 목적지 처리기가 늦은 SUBSCRIBE 를 원본 세션 속성째 이리로 다시 보낸다.
        MessageBrokerRegistry brokers = new MessageBrokerRegistry(mock(SubscribableChannel.class),
                mock(MessageChannel.class));
        config.configureMessageBroker(brokers);
        List<?> brokerInterceptors = ReflectionTestUtils.invokeMethod(brokers.configureBrokerChannel(),
                "getInterceptors");
        assertThat(brokerInterceptors).hasSize(1);
        assertThat(brokerInterceptors.get(0)).isInstanceOf(EndedSessionGuard.class);
        // 브로커 채널은 동기 — executor 를 주면 OutboundSendBudget 의 제출 스레드 MDC 캡처가 끊긴다(GROMO-2559).
        assertThat(ReflectionTestUtils.<Object>invokeMethod(brokers.configureBrokerChannel(), "hasExecutor"))
                .isEqualTo(false);

        Interceptors outbound = new Interceptors();
        config.configureClientOutboundChannel(outbound);
        assertThat(outbound.list()).containsExactly(movementOutbound, chatOutbound, budget);
    }

    @Test
    @DisplayName("연결 수립이 실패해도 종료 경로와 같은 짝으로 정리한다 — 소켓 기록을 지운 뒤 이동 쪽")
    void failedEstablishmentCleansUpLikeAClose() throws Exception {
        Decorators transport = new Decorators();
        config.configureWebSocketTransport(transport);
        WebSocketHandler failing = mock(WebSocketHandler.class);
        willThrow(new IllegalStateException("수립 실패")).given(failing).afterConnectionEstablished(any());
        WebSocketSession socket = mock(WebSocketSession.class);
        when(socket.getId()).thenReturn("socket-1");

        WebSocketHandler decorated = transport.decorateAll(failing);

        assertThatThrownBy(() -> decorated.afterConnectionEstablished(socket))
                .isInstanceOf(IllegalStateException.class);
        var order = inOrder(sessions, authzCache, movementSubscriptions);
        order.verify(sessions).closed("socket-1");
        order.verify(authzCache).evictSession("socket-1");
        order.verify(movementSubscriptions).closed("socket-1");
    }

    @Test
    @DisplayName("소켓 종료 이벤트가 그 소켓의 세션 속성에 끝난 세션 표시를 남긴다")
    void socketCloseEventMarksTheSessionEnded() {
        Map<String, Object> socketAttributes = new ConcurrentHashMap<>();
        StompHeaderAccessor headers = StompHeaderAccessor.create(StompCommand.DISCONNECT);
        headers.setSessionId("socket-1");
        headers.setSessionAttributes(socketAttributes);
        Message<byte[]> disconnect = MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());

        config.markEndedSession(new SessionDisconnectEvent(this, disconnect, "socket-1", CloseStatus.NORMAL));

        assertThat(socketAttributes).containsKey(EndedSessionGuard.ENDED);
    }

    /** {@code getInterceptors()} 가 protected 라 하위 클래스로 꺼낸다. */
    private static final class Interceptors extends ChannelRegistration {
        List<ChannelInterceptor> list() {
            return getInterceptors();
        }
    }

    /** {@code getDecoratorFactories()} 가 protected 라 하위 클래스로 꺼낸다. */
    private static final class Decorators extends WebSocketTransportRegistration {
        WebSocketHandler decorateAll(WebSocketHandler handler) {
            WebSocketHandler decorated = handler;
            for (WebSocketHandlerDecoratorFactory factory : getDecoratorFactories()) {
                decorated = factory.decorate(decorated);
            }
            return decorated;
        }
    }
}

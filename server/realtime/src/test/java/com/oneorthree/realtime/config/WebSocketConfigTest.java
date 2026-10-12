package com.oneorthree.realtime.config;

import com.oneorthree.realtime.movement.stomp.MovementOutboundInterceptor;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;

import java.util.List;

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
    private final WebSocketConfig config = new WebSocketConfig(mock(StompAuthChannelInterceptor.class),
            mock(ChatStompErrorHandler.class), chatOutbound, sessions, movementSubscriptions, movementOutbound);

    @Test
    @DisplayName("인바운드는 관문 → 이동 구독 처리, 아웃바운드는 이동 완료 통지 → 채팅 검사 순이다")
    void interceptorOrderIsTheContract() {
        Interceptors inbound = new Interceptors();
        config.configureClientInboundChannel(inbound);
        assertThat(inbound.list()).hasSize(2);
        assertThat(inbound.list().get(0).getClass().getSimpleName()).isEqualTo("RejectAsErrorFrame");
        assertThat(inbound.list().get(1)).isSameAs(movementSubscriptions);

        Interceptors outbound = new Interceptors();
        config.configureClientOutboundChannel(outbound);
        assertThat(outbound.list()).containsExactly(movementOutbound, chatOutbound);
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

        WebSocketHandler decorated = transport.list().get(0).decorate(failing);

        assertThatThrownBy(() -> decorated.afterConnectionEstablished(socket))
                .isInstanceOf(IllegalStateException.class);
        var order = inOrder(sessions, movementSubscriptions);
        order.verify(sessions).closed("socket-1");
        order.verify(movementSubscriptions).closed("socket-1");
    }

    /** {@code getInterceptors()} 가 protected 라 하위 클래스로 꺼낸다. */
    private static final class Interceptors extends ChannelRegistration {
        List<ChannelInterceptor> list() {
            return getInterceptors();
        }
    }

    /** {@code getDecoratorFactories()} 가 protected 라 하위 클래스로 꺼낸다. */
    private static final class Decorators extends WebSocketTransportRegistration {
        List<WebSocketHandlerDecoratorFactory> list() {
            return getDecoratorFactories();
        }
    }
}

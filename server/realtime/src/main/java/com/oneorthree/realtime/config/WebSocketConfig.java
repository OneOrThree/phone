package com.oneorthree.realtime.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;

/**
 * STOMP 배선.
 *
 * <table>
 *   <caption>경로 규약</caption>
 *   <tr><th>경로</th><th>뜻</th></tr>
 *   <tr><td>{@code /ws/chat}</td><td>핸드셰이크 엔드포인트. 인증은 첫 CONNECT 프레임에서 한다</td></tr>
 *   <tr><td>{@code /app/groups/{groupId}/send}</td><td>발신 — 컨트롤러가 받는다</td></tr>
 *   <tr><td>{@code /topic/groups/{groupId}}</td><td>그 섬의 브로드캐스트. 구독은 멤버만</td></tr>
 *   <tr><td>{@code /user/queue/errors}</td><td>발신 실패 통지(세션별 개인 큐)</td></tr>
 * </table>
 *
 * <h2>브로커가 인메모리인 것을 잊지 마라</h2>
 * {@code enableSimpleBroker} 는 <b>이 프로세스의 구독자만</b> 안다. 인스턴스 간 전달은
 * {@code ChatFanout} 의 Redis Pub/Sub 이 맡는다 — 이 조합이 이 서비스의 스케일아웃 전략이고,
 * 둘 중 하나만 보면 「왜 브로커 릴레이(RabbitMQ/ActiveMQ)를 안 쓰지」로 읽힌다. 이유는 외부 브로커를
 * 하나 더 운영하지 않기 위해서다(Redis 는 어차피 멤버십 캐시·프레즌스로 이미 필요하다).
 *
 * <h2>SockJS 폴백은 켜지 않는다</h2>
 * 클라이언트가 React Native 앱 하나뿐이고 WebSocket 을 네이티브로 지원한다. 폴백을 켜면 XHR 스트리밍
 * 경로가 열려 인증·타임아웃 규칙을 두 벌 관리해야 한다.
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;
    private final ChatStompErrorHandler chatStompErrorHandler;
    private final ChatOutboundChannelInterceptor chatOutboundChannelInterceptor;
    private final RealtimeSessionRegistry sessions;

    /** 거절 ERROR 프레임을 보낼 통로. 이 설정이 채널을 만드는 쪽이라 순환을 피해 늦게 받는다. */
    @Lazy
    @Autowired
    @Qualifier("clientOutboundChannel")
    private MessageChannel clientOutboundChannel;

    /**
     * 핸드셰이크에서 허용할 Origin.
     *
     * <p>기본값을 {@code *} 로 두지 않는다 — 네이티브 앱은 Origin 을 안 보내지만 브라우저는 보내고,
     * 열어 두면 임의의 웹페이지가 사용자의 토큰으로 소켓을 열 수 있다(토큰을 훔치진 못해도, 토큰을
     * 가진 다른 웹 컨텍스트에서 우리 소켓에 붙는 경로가 생긴다).
     */
    @Value("${chat.websocket.allowed-origins:}")
    private String[] allowedOrigins;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws/chat", "/ws/realtime")
                .setAllowedOriginPatterns(allowedOrigins);
        registry.setErrorHandler(chatStompErrorHandler);
        // 한 세션이 연달아 보낸 SEND 를 받은 순서대로 처리한다(GROMO-1741 §①). 끄면 인바운드 채널이 스레드
        // 풀이라 나중에 보낸 말이 먼저 저장돼 히스토리 순서가 뒤집힌다(실측: 40건 몰아 보내기에서 18자리가 뒤바뀜).
        // 켜는 대가는 관문 거절이 예외로는 클라이언트에 닿지 않는다는 것 — 그래서 RejectAsErrorFrame 이 있다.
        registry.setPreserveReceiveOrder(true);
    }

    /** STOMP 세션 ID와 같은 실제 소켓을 등록하고 모든 연결 종료 경로에서 정리한다. */
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.addDecoratorFactory(handler -> new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                sessions.opened(session);
                try {
                    super.afterConnectionEstablished(session);
                } catch (Exception e) {
                    sessions.closed(session.getId());
                    throw e;
                }
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
                try {
                    super.afterConnectionClosed(session, status);
                } finally {
                    sessions.closed(session.getId());
                }
            }
        });
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    /** 인증·구독·발신 목적지를 검사한다. */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new RejectAsErrorFrame());
    }

    /**
     * 관문의 거절을 <b>직접</b> ERROR 프레임으로 돌려보낸다.
     *
     * <p>순서 보존({@code setPreserveReceiveOrder})을 켜면 Spring 의 {@code OrderedMessageChannelDecorator} 가
     * 인바운드 전송의 예외를 삼켜 로그만 남긴다 — 그 예외를 받아 ERROR 프레임을 만들던
     * {@code StompSubProtocolHandler} 까지 올라가지 않으므로, 거절(토큰 없음·남의 섬·집중 중)이 클라이언트에
     * 영영 도착하지 않는다. 그래서 여기서 같은 에러 핸들러로 프레임을 만들어 아웃바운드 채널로 보내고,
     * 프레임은 {@code null} 로 버린다. ERROR 프레임을 보낸 뒤 소켓을 닫는 것은 종전과 같다(Spring 이 한다).
     */
    private final class RejectAsErrorFrame implements ChannelInterceptor {

        @Override
        public Message<?> preSend(Message<?> message, MessageChannel channel) {
            try {
                return stompAuthChannelInterceptor.preSend(message, channel);
            } catch (RuntimeException e) {
                Message<byte[]> error = chatStompErrorHandler.handleClientMessageProcessingError(null, e);
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(error, StompHeaderAccessor.class);
                if (accessor != null) {
                    accessor.setSessionId(SimpMessageHeaderAccessor.getSessionId(message.getHeaders()));
                }
                clientOutboundChannel.send(error);
                return null;
            }
        }
    }

    /** 이미 구독한 소켓도 집중 시작·토큰 만료 뒤에는 채팅 본문을 받지 못한다. */
    @Override
    public void configureClientOutboundChannel(ChannelRegistration registration) {
        registration.interceptors(chatOutboundChannelInterceptor);
    }
}

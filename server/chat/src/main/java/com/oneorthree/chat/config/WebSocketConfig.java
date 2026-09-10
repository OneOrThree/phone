package com.oneorthree.chat.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

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
        registry.addEndpoint("/ws/chat")
                .setAllowedOriginPatterns(allowedOrigins);
        registry.setErrorHandler(chatStompErrorHandler);
        // ⚠️ setPreserveReceiveOrder(true) 를 «켜지 마라» — 이 설계에서는 거절 통지가 통째로 사라진다.
        //
        // 켜야 할 이유는 있다: 인바운드 채널이 스레드 풀이라 한 세션의 두 SEND 가 동시에 처리될 수
        // 있고, 그러면 나중에 보낸 말이 먼저 id·sentAt 을 받아 히스토리 순서가 뒤집힌다(GROMO-1746).
        //
        // 그런데 켜 보면 «거절이 클라이언트에 도달하지 않는다». 이 서비스의 관문은
        // StompAuthChannelInterceptor 의 preSend 에서 «예외를 던져» 거절하는데, 순서 보존 데코레이터가
        // 그 경로에서 세션의 다음 전송을 풀어 주지 않아 ERROR 프레임이 큐에 남는다. 실측: 켠 채로
        // ChatWebSocketIntegrationTest 의 거절 3종(토큰 없음·남의 섬 구독·집중 중 CONNECT)이 전부
        // 30초 타임아웃 후 null 로 실패하고, 이 한 줄만 지우면 전부 통과한다.
        //
        // 즉 「순서가 가끔 뒤집힌다」를 고치려다 「거절이 영영 안 온다」를 만든다 — 후자가 훨씬 나쁘다.
        // 순서를 고치려면 관문이 예외 대신 다른 방식으로 거절하도록 먼저 바꿔야 한다(GROMO-1746).
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    /**
     * 인바운드 채널에 관문을 건다.
     *
     * <p><b>인터셉터는 인바운드에만 건다.</b> 아웃바운드에도 걸면 브로드캐스트 한 건이 구독자 수만큼
     * 관문을 다시 통과하게 되어, 멤버십 조회가 인원수만큼 돈다 — 구독 시점에 이미 검사했으므로
     * 나가는 길에 다시 볼 이유가 없다.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }
}

package com.oneorthree.realtime.config;

import com.oneorthree.realtime.movement.stomp.MovementOutboundInterceptor;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
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
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
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
 *
 * <h2>heartbeat 10s/10s — 유휴 연결 유지 계약 (GROMO-2341)</h2>
 * 서버가 {@code heart-beat:10000,10000} 을 협상한다. 앱({@code islandRealtime.ts})도 10s/10s 를 보내므로 CONNECTED 는
 * {@code heart-beat:10000,10000} 이고, 살아 있는 연결은 10초마다 양방향 바이트가 흐른다 — 프록시 유휴 상한(Cloudflare
 * 약 100s, nginx {@code proxy_read/send_timeout})에 걸리지 않는다. 클라이언트가 3회(30s) 동안 아무것도 보내지 않으면
 * {@code SimpleBroker} 가 세션을 닫는다(죽은 연결 정리). {@code heart-beat:0,0} 클라이언트(부하 도구 등)는 양쪽 다
 * heartbeat 가 꺼진다 — 종전과 같다. heartbeat 는 전용 1스레드 스케줄러({@code realtime-heartbeat-})가 돈다.
 *
 * <h2>송신 예산 (GROMO-2340)</h2>
 * 아웃바운드 실행기는 유한 큐다({@link OutboundSendBudget} — 크기·포화 정책·지표). 세션별 송신 시간·버퍼·수신 메시지
 * 크기 상한은 Spring 기본값(10s·512KB·64KB)을 <b>명시</b>하고 {@code chat.websocket.transport.*} 로 노출한다.
 */
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;
    private final ChatStompErrorHandler chatStompErrorHandler;
    private final ChatOutboundChannelInterceptor chatOutboundChannelInterceptor;
    private final RealtimeSessionRegistry sessions;
    private final MovementSubscriptionListener movementSubscriptions;
    private final MovementOutboundInterceptor movementOutboundInterceptor;
    private final OutboundSendBudget outboundSendBudget;
    private final OutboundAuthzCache outboundAuthzCache;
    private final MeterRegistry meterRegistry;
    private final WebSocketConnectionDiagnostics connectionDiagnostics = new WebSocketConnectionDiagnostics();

    /** 서버 heartbeat 송신 주기(ms) — 앱 {@code realtimeClientOptions} 의 10_000 과 같은 값이 기본이다. */
    @Value("${chat.websocket.heartbeat.server-ms:10000}")
    private long heartbeatServerMillis;

    /** 클라이언트에게 기대하는 heartbeat 주기(ms) — 3배 동안 아무것도 안 오면 브로커가 세션을 닫는다. */
    @Value("${chat.websocket.heartbeat.client-ms:10000}")
    private long heartbeatClientMillis;

    /** 세션 하나의 송신 한 건이 끝나기를 기다리는 상한 — 넘기면 Spring 이 그 세션을 4500 으로 닫는다. */
    @Value("${chat.websocket.transport.send-time-limit-ms:10000}")
    private int sendTimeLimitMillis;

    /** 느린 세션에 쌓아 둘 수 있는 송신 버퍼 — 넘기면 Spring 이 그 세션을 4500 으로 닫는다. */
    @Value("${chat.websocket.transport.send-buffer-size-limit-bytes:524288}")
    private int sendBufferSizeLimitBytes;

    /** 수신 STOMP 메시지 크기 상한. */
    @Value("${chat.websocket.transport.message-size-limit-bytes:65536}")
    private int messageSizeLimitBytes;

    @Value("${chat.websocket.inbound.threads:4}")
    private int inboundThreads;

    @Value("${chat.websocket.inbound.queue-capacity:256}")
    private int inboundQueueCapacity;

    /** 거절 ERROR 프레임을 보낼 통로. 이 설정이 채널을 만드는 쪽이라 순환을 피해 늦게 받는다. */
    @Lazy
    @Autowired
    @Qualifier("clientOutboundChannel")
    private MessageChannel clientOutboundChannel;

    /**
     * 핸드셰이크에서 허용할 Origin.
     *
     * <p>React Native 앱도 Origin 을 보낸다 — iOS(SocketRocket)·Android(WebSocketModule) 모두 WS 접속 URL 로
     * {@code Origin: https://<WS 호스트[:비표준 포트]>} 를 만든다(지금은 API 도메인과 같은 호스트). 그래서 환경마다
     * 그 도메인을 넣어야 앱이 붙는다(GROMO-2175). 빈 배열이면 Spring 은 same-origin 만 허용하는데, 앞단 프록시
     * 뒤에서는 요청 주소가 공개 도메인과 달라 사실상 Origin 을 보낸 핸드셰이크 전부 403 이다. Origin 이 없는 요청은
     * 이 검사를 거치지 않는다.
     *
     * <p>그래도 기본값을 {@code *} 로 두지 않는다 — 열어 두면 임의의 웹페이지가 사용자의 토큰으로 소켓을
     * 열 수 있다(토큰을 훔치진 못해도, 토큰을 가진 다른 웹 컨텍스트에서 우리 소켓에 붙는 경로가 생긴다).
     * 값이 빠진 배포는 조용히 열리는 대신 403 으로 드러난다.
     */
    @Value("${chat.websocket.allowed-origins:}")
    private String[] allowedOrigins;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws/chat", "/ws/realtime")
                .setHandshakeHandler(new NoCompressionHandshakeHandler())
                .addInterceptors(connectionDiagnostics)
                .setAllowedOriginPatterns(allowedOrigins);
        registry.setErrorHandler(chatStompErrorHandler);
        // 한 세션이 연달아 보낸 SEND 를 받은 순서대로 처리한다(GROMO-1741 §①). 끄면 인바운드 채널이 스레드
        // 풀이라 나중에 보낸 말이 먼저 저장돼 히스토리 순서가 뒤집힌다(실측: 40건 몰아 보내기에서 18자리가 뒤바뀜).
        // 켜는 대가는 관문 거절이 예외로는 클라이언트에 닿지 않는다는 것 — 그래서 RejectAsErrorFrame 이 있다.
        registry.setPreserveReceiveOrder(true);
    }

    /**
     * STOMP 세션 ID와 같은 실제 소켓을 등록하고 모든 연결 종료 경로에서 정리한다 — 전달 직전 인가 캐시도 함께 지운다.
     * 세션 송신 상한은 기본값을 명시한다(값을 바꾸지 않는다 — {@code MovementOutbox.STUCK_NANOS} 15s 가 10s 를 전제한다).
     */
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.setSendTimeLimit(sendTimeLimitMillis)
                .setSendBufferSizeLimit(sendBufferSizeLimitBytes)
                .setMessageSizeLimit(messageSizeLimitBytes);
        registration.addDecoratorFactory(connectionDiagnostics);
        registration.addDecoratorFactory(handler -> new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                sessions.opened(session);
                try {
                    super.afterConnectionEstablished(session);
                } catch (Exception e) {
                    // 종료 경로와 같은 순서·같은 짝 — 소켓 기록을 지운 뒤 이동 쪽 정리.
                    sessions.closed(session.getId());
                    outboundAuthzCache.evictSession(session.getId());
                    movementSubscriptions.closed(session.getId());
                    throw e;
                }
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
                try {
                    super.afterConnectionClosed(session, status);
                } finally {
                    sessions.closed(session.getId());
                    outboundAuthzCache.evictSession(session.getId());
                    outboundSendBudget.closed(session.getId(), status);
                    // 소켓 기록을 지운 «뒤»에 이동 방에서 내보낸다 — 순서 보존 큐에 남아 늦게 처리되는 SUBSCRIBE 가
                    // 끊긴 세션을 보고 물러나게 하는 전제다(MovementSubscriptionListener).
                    movementSubscriptions.closed(session.getId());
                }
            }
        });
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[] {heartbeatServerMillis, heartbeatClientMillis})
                .setTaskScheduler(realtimeHeartbeatScheduler());
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    /**
     * 브로커 heartbeat 전용 스케줄러 — 1스레드면 충분하다(10초마다 세션을 한 번 훑어 쓸 것만 아웃바운드 채널에 넘긴다).
     * Spring 의 {@code messageBrokerTaskScheduler}(CPU 수 스레드)와 나눠 이름으로 드러낸다.
     */
    @Bean
    public ThreadPoolTaskScheduler realtimeHeartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("realtime-heartbeat-");
        scheduler.setDaemon(true);
        return scheduler;
    }

    /**
     * 인증·구독·발신 목적지를 검사한다. 이동 구독 처리는 관문 <b>뒤</b>다 — 관문이 거절한 프레임(null)에서 체인이 멈춰,
     * 통과한 SUBSCRIBE 만 방 입장이 된다.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // Boot가 유일한 AsyncTaskExecutor인 heartbeat scheduler를 고르는 기본 배선을 명시적으로 덮는다.
        // clientInboundChannelExecutor 빈으로 초기화·종료되므로 여기서는 initialize()를 부르지 않는다.
        registration.executor(new InboundTaskExecutor(inboundThreads, inboundQueueCapacity, meterRegistry));
        // 끝난 세션의 늦은 CONNECT·SUBSCRIBE 를 맨 앞에서 버린다 — 포화 중 종료 DISCONNECT 가 그것들을 추월한다.
        registration.interceptors(new EndedSessionGuard(), new RejectAsErrorFrame(), movementSubscriptions);
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

    /**
     * 이미 구독한 소켓도 집중 시작·토큰 만료 뒤에는 채팅 본문을 받지 못한다.
     *
     * <p>이동 완료 통지가 <b>맨 앞</b>이다 — {@code afterMessageHandled} 는 {@code beforeHandle} 을 통과한
     * 인터셉터에게만 오므로, 채팅 인터셉터 뒤에 두면 그쪽이 버린 이동 프레임(토큰 만료)의 완료가 영영 오지 않아
     * 그 세션의 이동 송신이 멈춘다. 송신 시간 측정({@link OutboundSendBudget})은 <b>맨 뒤</b>다 — 앞 둘의 판정 시간을
     * 빼고 소켓 쓰기만 잰다.
     *
     * <p>실행기는 유한 큐다(GROMO-2340) — 크기·포화 정책은 {@link OutboundSendBudget}.
     */
    @Override
    public void configureClientOutboundChannel(ChannelRegistration registration) {
        registration.executor(outboundSendBudget.newExecutor());
        registration.interceptors(movementOutboundInterceptor, chatOutboundChannelInterceptor, outboundSendBudget);
    }
}

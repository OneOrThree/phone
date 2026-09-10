package com.oneorthree.chat;

import com.oneorthree.chat.common.redis.RedisKeys;
import com.oneorthree.chat.fanout.ChatFanout;
import com.oneorthree.chat.fanout.ChatFanoutEvent;
import com.oneorthree.chat.membership.client.GroupClient;
import com.oneorthree.chat.message.dto.ChatMessageResponse;
import com.oneorthree.chat.message.dto.SendFailureResponse;
import com.oneorthree.chat.message.dto.SendMessageRequest;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.lang.NonNull;
import org.springframework.messaging.converter.CompositeMessageConverter;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.converter.SimpleMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;

/**
 * 실제 소켓으로 두 규칙을 확인한다 — <b>같은 섬 안에서만</b>, <b>집중 중엔 못 들어온다</b>.
 *
 * <p>단위 테스트로 관문을 이미 봤는데도 이걸 두는 이유는, 관문이 «호출되도록 배선되었는가»는 단위
 * 테스트가 절대 못 보기 때문이다. 인터셉터를 인바운드 채널에 등록하는 줄 하나만 빠져도 규칙은
 * 통째로 사라지는데, 그때도 {@code ChatAccessGuardTest} 는 전부 초록이다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ChatWebSocketIntegrationTest {

    private static final long TIMEOUT_SECONDS = 15;

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private StringRedisTemplate redis;

    @MockitoBean
    private GroupClient groupClient;

    @Autowired
    private ChatFanout chatFanout;

    @Autowired
    private ObjectMapper objectMapper;

    private WebSocketStompClient stompClient;

    private BlockingQueue<ChatMessageResponse> deliveries;

    /**
     * userId 당 토큰을 <b>한 번만</b> 만들어 재사용한다.
     *
     * <p>매번 새로 만들면 {@code exp} 가 초 단위로 달라져 토큰 문자열이 바뀌고, 그러면 상류 목의
     * 스텁이 «다른 인자»로 어긋나 조용히 null 을 돌려준다 — 테스트가 규칙 때문이 아니라 스텁 미스로
     * 실패하게 된다.
     */
    private final Map<UUID, String> bearers = new HashMap<>();

    private UUID island;
    private UUID resident;
    private UUID outsider;

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        resident = UUID.randomUUID();
        outsider = UUID.randomUUID();

        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        // Jackson 3 은 java.time 지원이 내장이라 모듈 등록이 필요 없다 — Instant 가 그냥 직렬화된다.
        // SimpleMessageConverter 를 뒤에 두는 이유: ERROR 프레임 본문을 byte[] 로 받기 위해서다.
        // Jackson 하나만 두면 byte[] 변환이 실패하고, 그 실패는 handleFrame 대신 handleException 으로
        // 빠져 «에러 코드가 null» 로 보인다(실제로 이 테스트가 그렇게 한 번 깨졌다).
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));

    }

    @AfterEach
    void tearDown() {
        redis.delete(RedisKeys.memberCache(resident));
        redis.delete(RedisKeys.memberCache(outsider));
        redis.delete(RedisKeys.focusPresence(resident));
        stompClient.stop();
    }

    @Test
    @DisplayName("섬 주민은 붙어서 말하고, 그 말이 구독자에게 되돌아온다")
    void memberCanSendAndReceive() throws Exception {
        givenMemberOf(resident, island);

        RecordingHandler handler = new RecordingHandler();
        StompSession session = connect(resident, handler);
        deliveries = subscribeToIsland(session, island);

        UUID clientMessageId = UUID.randomUUID();
        ChatMessageResponse message = sendUntilDelivered(session, island,
                new SendMessageRequest("안녕 섬사람들", clientMessageId));

        assertThat(message).isNotNull();
        assertThat(message.content()).isEqualTo("안녕 섬사람들");
        assertThat(message.senderId()).isEqualTo(resident);
        assertThat(message.groupId()).isEqualTo(island);
        // 발신자가 자기 낙관적 렌더링을 갈아 끼울 근거.
        assertThat(message.clientMessageId()).isEqualTo(clientMessageId);
    }

    @Test
    @DisplayName("남의 섬은 구독조차 못 한다 — 관문이 실제로 배선되어 있는가")
    void outsiderCannotSubscribe() throws Exception {
        givenMemberOf(outsider, UUID.randomUUID());

        RecordingHandler handler = new RecordingHandler();
        StompSession session = connect(outsider, handler);

        session.subscribe("/topic/groups/" + island, new DiscardingFrameHandler());

        assertThat(handler.awaitError()).isEqualTo("NOT_A_MEMBER");
    }

    @Test
    @DisplayName("집중 중이면 연결 자체가 거절된다 — 소켓이 열린 채 아무것도 안 되는 상태를 만들지 않는다")
    void focusingUserCannotConnect() throws Exception {
        givenMemberOf(resident, island);
        // Data API 가 집중 시작 시 쓰는 리스를 흉내 낸다. 채팅은 «존재 여부»만 본다.
        redis.opsForValue().set(RedisKeys.focusPresence(resident), "1", Duration.ofMinutes(5));

        RecordingHandler handler = new RecordingHandler();
        assertThatThrownBy(() -> connect(resident, handler)).isInstanceOf(Exception.class);

        assertThat(handler.awaitError()).isEqualTo("FOCUS_IN_PROGRESS");
    }

    @Test
    @DisplayName("집중이 끝나면(리스가 사라지면) 다시 붙는다 — 차단이 영구가 아니다")
    void reconnectsAfterFocusEnds() throws Exception {
        givenMemberOf(resident, island);
        redis.opsForValue().set(RedisKeys.focusPresence(resident), "1", Duration.ofMinutes(5));
        assertThatThrownBy(() -> connect(resident, new RecordingHandler())).isInstanceOf(Exception.class);

        redis.delete(RedisKeys.focusPresence(resident));

        assertThat(connect(resident, new RecordingHandler()).isConnected()).isTrue();
    }

    @Test
    @DisplayName("토큰이 없으면 붙지 못한다")
    void anonymousCannotConnect() throws Exception {
        RecordingHandler handler = new RecordingHandler();

        assertThatThrownBy(() -> connectWith(null, handler)).isInstanceOf(Exception.class);

        assertThat(handler.awaitError()).isEqualTo("UNAUTHORIZED");
    }

    @Test
    @DisplayName("다른 인스턴스가 흘린 말도 내게 도착한다 — 스케일아웃의 전부가 이 한 줄에 달려 있다")
    void receivesMessageFromAnotherInstance() throws Exception {
        givenMemberOf(resident, island);
        StompSession session = connect(resident, new RecordingHandler());
        deliveries = subscribeToIsland(session, island);

        // 「다른 인스턴스」 = 이 프로세스의 것이 아닌 originInstanceId. Redis 채널에 직접 흘려서
        // 두 번째 서버를 띄우지 않고도 그 인스턴스가 발행한 것과 같은 상황을 만든다.
        ChatMessageResponse fromElsewhere = new ChatMessageResponse(
                UUID.randomUUID(), island, UUID.randomUUID(), "옆 인스턴스에서 왔습니다",
                Instant.now(), UUID.randomUUID());
        ChatMessageResponse delivered = publishForeignUntilDelivered(fromElsewhere);

        assertThat(delivered).isNotNull();
        assertThat(delivered.content()).isEqualTo("옆 인스턴스에서 왔습니다");
    }

    @Test
    @DisplayName("내가 발행한 것이 되돌아오면 버린다 — 아니면 같은 말이 두 번 보인다")
    void ignoresOwnEcho() throws Exception {
        givenMemberOf(resident, island);
        StompSession session = connect(resident, new RecordingHandler());
        deliveries = subscribeToIsland(session, island);

        // 위 테스트와 같은 경로에 originInstanceId 만 «이 프로세스의 것»으로 바꿔 흘린다.
        publishToFanout(chatFanout.instanceId(), new ChatMessageResponse(
                UUID.randomUUID(), island, UUID.randomUUID(), "메아리",
                Instant.now(), UUID.randomUUID()));

        assertThat(deliveries.poll(2, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("본문이 틀린 발신 한 건은 «그 건만» 거절된다 — 세션이 죽지 않는다")
    void invalidPayloadDoesNotKillTheSession() throws Exception {
        givenMemberOf(resident, island);
        StompSession session = connect(resident, new RecordingHandler());
        BlockingQueue<SendFailureResponse> errors = subscribeToPersonalErrors(session);
        deliveries = subscribeToIsland(session, island);

        // clientMessageId 없이 보낸다(@NotNull 위반). 핸들러가 없으면 ERROR 프레임 + 소켓 종료다.
        session.send("/app/groups/" + island + "/send", new SendMessageRequest("안녕", null));

        SendFailureResponse failure = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo("INVALID_REQUEST");
        // 본문을 못 읽어 생긴 실패라 서버도 어느 요청인지 특정할 수 없다.
        assertThat(failure.getClientMessageId()).isNull();
        assertThat(session.isConnected()).isTrue();

        // 그리고 같은 세션으로 «정상» 발신이 계속 된다 — 이게 「죽지 않았다」의 실질적 확인이다.
        ChatMessageResponse recovered = sendUntilDelivered(session, island,
                new SendMessageRequest("다시 안녕", UUID.randomUUID()));
        assertThat(recovered).isNotNull();
        assertThat(recovered.content()).isEqualTo("다시 안녕");
    }

    @Test
    @DisplayName("집중 중 발신은 개인 큐로 거절이 오고 세션은 살아 있다")
    void sendWhileFocusingIsRefusedOnPersonalQueue() throws Exception {
        givenMemberOf(resident, island);
        StompSession session = connect(resident, new RecordingHandler());
        BlockingQueue<SendFailureResponse> errors = subscribeToPersonalErrors(session);

        // 연결 «뒤에» 집중이 시작된 상황 — 서버는 세션을 끊지 않고 발신만 막는다(C5).
        redis.opsForValue().set(RedisKeys.focusPresence(resident), "1", Duration.ofMinutes(5));

        UUID clientMessageId = UUID.randomUUID();
        session.send("/app/groups/" + island + "/send",
                new SendMessageRequest("집중 중인데 보냅니다", clientMessageId));

        SendFailureResponse failure = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo("FOCUS_IN_PROGRESS");
        // 실패 봉투에 멱등 키가 실려야 앱이 «어느» 낙관적 말풍선을 실패로 그릴지 안다.
        assertThat(failure.getClientMessageId()).isEqualTo(clientMessageId);
        assertThat(session.isConnected()).isTrue();
    }

    @Test
    @DisplayName("다른 Origin 의 핸드셰이크는 거절된다 — 브라우저에서 임의 페이지가 소켓을 열 수 없다")
    void crossOriginHandshakeIsRejected() {
        givenMemberOf(resident, island);

        // 네이티브 앱은 Origin 헤더 자체가 없어 영향이 없다(다른 테스트가 그 경로다). 여기서는
        // 브라우저처럼 Origin 을 실어 보내, 빈 allowed-origins 가 「전부 허용」이 아님을 못 박는다.
        // 이 단언이 없으면 그 성질이 Spring 내부 배선에만 기대게 된다.
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        handshakeHeaders.add("Origin", "https://evil.example");

        assertThatThrownBy(() -> stompClient.connectAsync("ws://localhost:" + port + "/ws/chat",
                        handshakeHeaders, authHeaders(bearerOf(resident)), new RecordingHandler())
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .isInstanceOf(Exception.class);
    }

    @Test
    @DisplayName("발신 실패는 «그 세션»에만 간다 — 같은 유저의 다른 기기가 보내지도 않은 실패를 받으면 안 된다")
    void sendFailureDoesNotReachTheUsersOtherSessions() throws Exception {
        givenMemberOf(resident, island);
        StompSession phone = connect(resident, new RecordingHandler());
        StompSession tablet = connect(resident, new RecordingHandler());
        BlockingQueue<SendFailureResponse> phoneErrors = subscribeToPersonalErrors(phone);
        BlockingQueue<SendFailureResponse> tabletErrors = subscribeToPersonalErrors(tablet);

        redis.opsForValue().set(RedisKeys.focusPresence(resident), "1", Duration.ofMinutes(5));
        phone.send("/app/groups/" + island + "/send",
                new SendMessageRequest("폰에서 보냅니다", UUID.randomUUID()));

        // @SendToUser 의 broadcast 기본값(true)이면 태블릿에도 같은 실패가 도착하고,
        // 그 기기는 «보낸 적도 없는» 말풍선을 실패 처리하려 든다.
        assertThat(phoneErrors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isNotNull();
        assertThat(tabletErrors.poll(2, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("남이 브로커 목적지로 직접 쏜 말은 그 방에 «도착하지 않는다» — 위조 메시지 봉쇄")
    void directBrokerSendNeverReachesTheRoom() throws Exception {
        givenMemberOf(resident, island);
        givenMemberOf(outsider, UUID.randomUUID());

        // 주민은 정상적으로 자기 섬을 듣고 있다.
        StompSession residentSession = connect(resident, new RecordingHandler());
        deliveries = subscribeToIsland(residentSession, island);

        // 외부인은 «컨트롤러를 거치지 않고» 브로커 목적지로 직접 쏜다. 목적지 검사가 없으면
        // 이 프레임은 그대로 구독자에게 전달된다 — 멤버십·집중·본문 검증·저장을 전부 건너뛰고.
        StompSession outsiderSession = connect(outsider, new RecordingHandler());
        outsiderSession.send("/topic/groups/" + island, new SendMessageRequest("위조", UUID.randomUUID()));

        assertThat(deliveries.poll(3, TimeUnit.SECONDS)).isNull();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private void givenMemberOf(UUID userId, UUID groupId) {
        given(groupClient.fetchMyGroupIds(bearerOf(userId))).willReturn(GroupClient.Membership.of(Set.of(groupId)));
    }

    private StompSession connect(UUID userId, RecordingHandler handler) throws Exception {
        return connectWith(bearerOf(userId), handler);
    }

    private StompSession connectWith(String authorization, RecordingHandler handler) throws Exception {
        return stompClient.connectAsync("ws://localhost:" + port + "/ws/chat",
                        new WebSocketHttpHeaders(), authHeaders(authorization), handler)
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    /** CONNECT 프레임에 실을 헤더. 핸드셰이크 헤더(Origin 등)와 «다른 층»이라 섞지 않는다. */
    private static StompHeaders authHeaders(String authorization) {
        StompHeaders connectHeaders = new StompHeaders();
        if (authorization != null) {
            connectHeaders.add("Authorization", authorization);
        }
        return connectHeaders;
    }

    /**
     * 그 섬의 브로드캐스트를 받을 큐를 연다.
     *
     * <p>구독이 «서버에 등록되기를» 기다리지 않는다 — 기다릴 방법이 없기 때문이다. Spring 의
     * {@code SimpleBroker} 는 SUBSCRIBE 에 RECEIPT 를 돌려주지 않고(DISCONNECT 에만 준다),
     * 인바운드 채널이 비동기라 {@code SessionSubscribeEvent} 도 등록 완료를 보장하지 않는다.
     * 그래서 도달 보장은 {@link #sendUntilDelivered} 쪽에서 «멱등 재전송»으로 만든다.
     */
    private BlockingQueue<ChatMessageResponse> subscribeToIsland(StompSession session, UUID groupId) {
        BlockingQueue<ChatMessageResponse> queue = new LinkedBlockingQueue<>();
        session.subscribe("/topic/groups/" + groupId, new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return ChatMessageResponse.class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                queue.add((ChatMessageResponse) payload);
            }
        });
        return queue;
    }

    /**
     * 도착할 때까지 <b>같은 {@code clientMessageId} 로</b> 다시 보낸다.
     *
     * <p>구독 등록과 발신 사이의 경합을 {@code sleep} 으로 눈감는 대신 재전송으로 없앤다. 같은 키로
     * 다시 보내는 건 안전하다 — 서버가 유니크 제약으로 «처음 저장된 그 메시지»를 돌려주고 다시
     * 브로드캐스트하므로, 몇 번을 보내도 방에 남는 말은 하나다. 덕분에 이 테스트는 재전송 멱등 경로까지
     * 함께 태운다.
     *
     * @return 받은 메시지. 끝내 못 받으면 null
     */
    private ChatMessageResponse sendUntilDelivered(StompSession session, UUID groupId,
            SendMessageRequest request) throws InterruptedException {
        for (int attempt = 0; attempt < 20; attempt++) {
            session.send("/app/groups/" + groupId + "/send", request);
            ChatMessageResponse received = deliveries.poll(500, TimeUnit.MILLISECONDS);
            if (received != null) {
                return received;
            }
        }
        return null;
    }

    /**
     * Redis 팬아웃 채널에 직접 흘린다.
     *
     * @param originInstanceId 발행자 신원. 이 프로세스의 것이면 구독자가 «자기 메아리»로 버려야 한다
     */
    private void publishToFanout(UUID originInstanceId, ChatMessageResponse message) {
        redis.convertAndSend(RedisKeys.FANOUT_CHANNEL,
                objectMapper.writeValueAsString(new ChatFanoutEvent(originInstanceId, message)));
    }

    /**
     * 구독 등록 경합을 재발행으로 없앤다({@link #sendUntilDelivered} 와 같은 이유).
     *
     * <p>Pub/Sub 는 저장하지 않으므로 구독 전에 흘린 것은 그대로 사라진다 — 한 번만 쏘면 CI 부하에서
     * 간헐적으로 놓친다.
     */
    private ChatMessageResponse publishForeignUntilDelivered(ChatMessageResponse message)
            throws InterruptedException {
        UUID foreignInstance = UUID.randomUUID();
        for (int attempt = 0; attempt < 20; attempt++) {
            publishToFanout(foreignInstance, message);
            ChatMessageResponse received = deliveries.poll(500, TimeUnit.MILLISECONDS);
            if (received != null) {
                return received;
            }
        }
        return null;
    }

    /** 발신 실패 통지를 받는 개인 큐. 봉투를 «통째로» 모은다 — clientMessageId 까지 봐야 해서다. */
    private BlockingQueue<SendFailureResponse> subscribeToPersonalErrors(StompSession session) {
        BlockingQueue<SendFailureResponse> errors = new LinkedBlockingQueue<>();
        session.subscribe("/user/queue/errors", new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return SendFailureResponse.class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                errors.add((SendFailureResponse) payload);
            }
        });
        return errors;
    }

    private String bearerOf(UUID userId) {
        return bearers.computeIfAbsent(userId, id -> "Bearer " + Jwts.builder()
                .subject(id.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact());
    }

    /**
     * ERROR 프레임의 {@code message} 헤더를 받아 둔다.
     *
     * <p>연결 전 거절(CONNECT)과 연결 후 거절(SUBSCRIBE)이 <b>같은 경로로</b> 온다 — 둘 다 ERROR
     * 프레임이다. 그래서 핸들러 하나로 두 경우를 다 본다. 본문 JSON 이 아니라 헤더를 보는 이유는
     * STOMP 클라이언트 중에 ERROR 본문을 노출하지 않는 것이 있어 코드를 헤더에도 싣기로 했고,
     * 그 계약을 여기서 확인하기 위해서다.
     */
    private static class RecordingHandler extends StompSessionHandlerAdapter {

        private final BlockingQueue<String> errors = new LinkedBlockingQueue<>();

        /** ERROR 본문은 JSON 이지만 여기서는 파싱하지 않는다 — 변환을 태우면 실패 지점이 하나 늘어난다. */
        @Override
        public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
            return byte[].class;
        }

        @Override
        public void handleFrame(@NonNull StompHeaders headers, Object payload) {
            String code = headers.getFirst("message");
            if (code != null) {
                errors.add(code);
            }
        }

        String awaitError() throws InterruptedException {
            return errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }
    }

    /** 도착하면 안 되는 프레임을 위한 자리. 받으면 테스트는 어차피 다른 단언에서 깨진다. */
    private static class DiscardingFrameHandler implements StompFrameHandler {

        @Override
        public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
            return byte[].class;
        }

        @Override
        public void handleFrame(@NonNull StompHeaders headers, Object payload) {
            // 무시한다.
        }
    }
}

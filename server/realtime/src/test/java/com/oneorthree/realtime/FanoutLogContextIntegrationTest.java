package com.oneorthree.realtime;

import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.config.ChatOutboundChannelInterceptor;
import com.oneorthree.realtime.event.RealtimeEventDelivery;
import com.oneorthree.realtime.event.RealtimeEventEnvelope;
import com.oneorthree.realtime.event.RealtimeEventFanoutEvent;
import com.oneorthree.realtime.event.RealtimeEventFanoutSubscriber;
import com.oneorthree.realtime.event.RealtimeEventType;
import com.oneorthree.realtime.fanout.ChatFanout;
import com.oneorthree.realtime.fanout.ChatFanoutEvent;
import com.oneorthree.realtime.fanout.ChatFanoutSubscriber;
import com.oneorthree.realtime.fanout.FanoutTelemetry;
import com.oneorthree.realtime.focus.IslandFocusSessions;
import com.oneorthree.realtime.logging.CapturedLogs;
import com.oneorthree.realtime.logging.LogContext;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.service.ChatUserFence;
import com.oneorthree.realtime.message.dto.ChatMessageResponse;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.DefaultMessage;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.lang.NonNull;
import org.springframework.messaging.converter.SimpleMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.util.MimeTypeUtils;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import static com.oneorthree.realtime.logging.CapturedLogs.event;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;

/**
 * Redis 팬아웃과 STOMP 처리 로그가 원인 요청에 이어지는지 (GROMO-2559) — 실제 소켓·실제 Redis·실제 실행기.
 *
 * <p>여기서 보는 것: STOMP 프레임의 request_id 가 발행 wire 의 원인으로 실려 Redis 를 건너 돌아오는지, 구독자 스레드가 원인·id
 * 를 깔았다가 되돌리는지, 아웃바운드 실행 스레드의 전달 직전 판정이 같은 id 를 다는지, 옛 wire(메타데이터 없음)도 받는지,
 * 클라이언트가 받는 «원문»에 메타데이터 키가 없는지. 인스턴스 두 대는 {@code TwoInstanceFanoutTest}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class FanoutLogContextIntegrationTest {

    private static final long TIMEOUT_MILLIS = 10_000;
    private static final Set<String> CHAT_KEYS = Set.of("messageId", "groupId", "senderId", "content", "sentAt",
            "clientMessageId");
    private static final Set<String> EVENT_KEYS = Set.of("eventId", "schemaVersion", "type", "islandId",
            "aggregateVersion", "occurredAt", "payload");
    /** 앱 로그 문맥 키 — 실행기 스레드에 남으면 안 된다. */
    private static final String[] APP_KEYS = {"request_id", "origin_request_id", "origin_trace_id", "user_id",
        "event_id", "delivery_id", "attempt", "message_id", "event_name"};
    /**
     * 모양이 깨진 관측 메타데이터 — 업무 봉투는 그대로 전달돼야 한다(계약 §0). 마지막은 v1 인데 한 필드만 틀린 것: 나머지 값도
     * 믿지 않고 통째로 버린다.
     */
    private static final List<String> BROKEN_TELEMETRY = List.of("{\"v\":\"invalid\"}",
            "{\"originRequestId\":{\"x\":1}}", "[1,2]", "7", "\"telemetry\"",
            "{\"v\":1,\"originRequestId\":\"req-half\",\"originTraceId\":{\"x\":1}}");

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ChatFanout chatFanout;

    @Autowired
    private RealtimeEventDelivery eventDelivery;

    @Autowired
    private ChatFanoutSubscriber chatSubscriber;

    @Autowired
    private RealtimeEventFanoutSubscriber eventSubscriber;

    @Autowired
    private ChatUserFence chatUserFence;

    @Autowired
    private ApplicationContext context;

    @MockitoBean
    private GroupClient groupClient;

    /** 차단 필터는 fail-closed — 목의 기본값(빈 집합)으로 «차단 없음». */
    @MockitoBean
    private BlockClient blockClient;

    /** 응원 구독 인가의 Data 정본 — 늘 진행 중. */
    @MockitoBean
    private IslandFocusSessions focusSessions;

    private WebSocketStompClient stompClient;
    private UUID island;
    private UUID alice;
    private String aliceBearer;

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        alice = UUID.randomUUID();
        aliceBearer = "Bearer " + Jwts.builder().subject(alice.toString()).claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8))).compact();
        given(groupClient.fetchMyGroupIds(aliceBearer)).willReturn(GroupClient.Membership.of(Set.of(island)));
        given(focusSessions.requireActiveSession(any(), any(), any())).willReturn(Set.of(alice));
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        // 원문(byte[])을 그대로 받는다 — 매퍼가 모르는 키를 버리면 누출을 못 잡는다.
        stompClient.setMessageConverter(new SimpleMessageConverter());
    }

    @AfterEach
    void tearDown() {
        stompClient.stop();
        MDC.clear();
    }

    @Test
    @DisplayName("STOMP 채팅 발신의 request_id 가 발행 줄·전달 직전 자리에 붙고, Redis 를 건너 돌아온 메아리의 원인이 된다 — 실행기 스레드엔 남지 않는다")
    void stompSendRequestIdBecomesTheFanoutOrigin() throws Exception {
        StompSession session = connect();
        String topic = "/topic/groups/" + island;
        BlockingQueue<String> raw = subscribeRaw(session, topic);
        try (CapturedLogs logs = CapturedLogs.of(ChatFanout.class, ChatFanoutSubscriber.class);
                OutboundSeat seat = OutboundSeat.attach(outboundChannel(), topic)) {
            JsonNode heard = sendChatUntilHeard(session, raw);
            String messageId = heard.get("messageId").stringValue();

            assertThat(keysOf(heard)).isEqualTo(CHAT_KEYS);
            CapturedLogs.Line published = single(logs.await(event(LogContext.FANOUT_PUBLISH, "chat:fanout")
                    .and(line -> messageId.equals(line.get("message_id"))), 1, TIMEOUT_MILLIS));
            String requestId = published.get("request_id");
            assertThat(UUID.fromString(requestId)).as("프레임마다 새 UUID").isNotNull();
            assertThat(published.get("user_id")).isEqualTo(alice.toString());
            CapturedLogs.Line echo = single(logs.await(event(LogContext.FANOUT_RECEIVE, "result=self_echo")
                    .and(line -> messageId.equals(line.get("message_id"))), 1, TIMEOUT_MILLIS));
            assertThat(echo.get("origin_request_id")).as("wire 의 원인 = 발신 프레임의 request_id").isEqualTo(requestId);
            assertThat(echo.get("request_id")).as("구독자 스레드는 자기 요청이 없다").isNull();
            Map<String, String> atAuthorization = seat.await("message_id", messageId);
            assertThat(atAuthorization).containsEntry("request_id", requestId)
                    .containsEntry("user_id", alice.toString());
            assertThat(seat.thread(messageId)).startsWith("realtime-outbound-");
        }
        assertNoAppContextLeftOn("clientInboundChannelExecutor");
        assertNoAppContextLeftOn("clientOutboundChannelExecutor");
    }

    @Test
    @DisplayName("chat:fanout — 옛 wire(telemetry 키 없음)도 전달하며 message_id 를 잇고, 새 wire 의 메타데이터는 클라이언트 원문에 없다")
    void chatWireBothShapesReachTheClientWithoutMetadata() throws Exception {
        StompSession session = connect();
        BlockingQueue<String> raw = subscribeRaw(session, "/topic/groups/" + island);
        try (CapturedLogs logs = CapturedLogs.of(ChatFanoutSubscriber.class)) {
            UUID oldId = UUID.randomUUID();
            String oldWire = "{\"originInstanceId\":\"" + UUID.randomUUID() + "\",\"message\":" + chatJson(oldId) + "}";
            JsonNode oldHeard = publishUntilHeard(RedisKeys.FANOUT_CHANNEL, oldWire, raw, "messageId", oldId);
            assertThat(keysOf(oldHeard)).isEqualTo(CHAT_KEYS);
            CapturedLogs.Line oldLine = logs.await(event(LogContext.FANOUT_RECEIVE, "result=delivered")
                    .and(line -> oldId.toString().equals(line.get("message_id"))), 1, TIMEOUT_MILLIS).get(0);
            assertThat(oldLine.mdc()).doesNotContainKeys("origin_request_id", "origin_trace_id");

            UUID newId = UUID.randomUUID();
            String newWire = "{\"originInstanceId\":\"" + UUID.randomUUID() + "\",\"message\":" + chatJson(newId)
                    + ",\"telemetry\":{\"v\":1,\"originRequestId\":\"req-chat\",\"originTraceId\":\"42\"}}";
            String newRaw = publishUntilHeardRaw(RedisKeys.FANOUT_CHANNEL, newWire, raw, "messageId", newId);
            assertThat(keysOf(objectMapper.readTree(newRaw))).isEqualTo(CHAT_KEYS);
            assertThat(newRaw).doesNotContain("telemetry").doesNotContain("req-chat");
            CapturedLogs.Line newLine = logs.await(event(LogContext.FANOUT_RECEIVE, "result=delivered")
                    .and(line -> newId.toString().equals(line.get("message_id"))), 1, TIMEOUT_MILLIS).get(0);
            assertThat(newLine.mdc()).containsEntry("origin_request_id", "req-chat")
                    .containsEntry("origin_trace_id", "42");
        }
    }

    @Test
    @DisplayName("chat:events:v1 — 옛 wire 도 전달하고, 전달 직전 판정(허용·거절)이 그 실행 스레드에서 같은 event_id·원인을 단다. 원문엔 7필드뿐")
    void eventWireReachesTheAuthorizationSeatWithItsIds() throws Exception {
        StompSession session = connect();
        String topic = "/topic/islands/" + island + "/emotes";
        BlockingQueue<String> raw = subscribeRaw(session, topic);
        try (CapturedLogs logs = CapturedLogs.of(RealtimeEventFanoutSubscriber.class,
                ChatOutboundChannelInterceptor.class); OutboundSeat seat = OutboundSeat.attach(outboundChannel(), topic)) {
            UUID oldEvent = UUID.randomUUID();
            JsonNode oldHeard = publishUntilHeard(RedisKeys.EVENT_FANOUT_CHANNEL,
                    emoteWire(oldEvent, Set.of(alice), null), raw, "eventId", oldEvent);
            assertThat(keysOf(oldHeard)).isEqualTo(EVENT_KEYS);
            CapturedLogs.Line oldLine = logs.await(event(LogContext.FANOUT_RECEIVE, "result=delivered")
                    .and(line -> oldEvent.toString().equals(line.get("event_id"))), 1, TIMEOUT_MILLIS).get(0);
            assertThat(oldLine.mdc()).as("옛 발행자도 봉투 eventId 로 잇는다").doesNotContainKey("origin_request_id");

            UUID allowed = UUID.randomUUID();
            String allowedRaw = publishUntilHeardRaw(RedisKeys.EVENT_FANOUT_CHANNEL,
                    emoteWire(allowed, Set.of(alice), "req-allow"), raw, "eventId", allowed);
            assertThat(keysOf(objectMapper.readTree(allowedRaw))).isEqualTo(EVENT_KEYS);
            assertThat(allowedRaw).doesNotContain("telemetry").doesNotContain("req-allow");
            assertThat(seat.await("event_id", allowed.toString())).containsEntry("origin_request_id", "req-allow");

            // 수신 대상 밖 — 기존 판정이 그대로 버리고, 그 판정 로그가 같은 id 를 단다.
            UUID denied = UUID.randomUUID();
            redis.convertAndSend(RedisKeys.EVENT_FANOUT_CHANNEL, emoteWire(denied, Set.of(UUID.randomUUID()), "req-deny"));
            CapturedLogs.Line deny = single(logs.await(line -> line.message().contains("응원 전달 차단 — 수신 대상이 아니다")
                    && denied.toString().equals(line.get("event_id")), 1, TIMEOUT_MILLIS));
            assertThat(deny.get("origin_request_id")).isEqualTo("req-deny");
            assertThat(deny.thread()).startsWith("realtime-outbound-");
            List<String> late = new ArrayList<>();
            raw.drainTo(late);
            String next = raw.poll(500, TimeUnit.MILLISECONDS);
            if (next != null) {
                late.add(next);
            }
            assertThat(late).as("거절된 프레임은 오지 않는다").noneMatch(frame -> frame.contains(denied.toString()));
        }
    }

    @Test
    @DisplayName("자기 메아리는 메타데이터가 있어도 전달하지 않고, 재사용 스레드의 바깥 문맥을 그대로 되돌린다 — 깨진 JSON 도 같다")
    void selfEchoIsIgnoredAndTheReusedThreadKeepsItsContext() throws Exception {
        MDC.put("origin_request_id", "outer-req");
        MDC.put("event_id", "outer-evt");
        MDC.put("message_id", "outer-msg");
        Map<String, String> before = MDC.getCopyOfContextMap();
        UUID messageId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        ChatMessageResponse message = new ChatMessageResponse(messageId, island, alice, "메아리", Instant.now(),
                UUID.randomUUID());
        String chatEcho = objectMapper.writeValueAsString(new ChatFanoutEvent(chatFanout.instanceId(), message,
                new FanoutTelemetry(1, "req-echo", null, null)));
        String eventEcho = objectMapper.writeValueAsString(RealtimeEventFanoutEvent.island(eventDelivery.instanceId(),
                "/topic/islands/" + island + "/emotes", emote(eventId), Set.of(alice),
                new FanoutTelemetry(1, "req-echo-evt", null, eventId.toString())));

        try (CapturedLogs logs = CapturedLogs.of(ChatFanoutSubscriber.class, RealtimeEventFanoutSubscriber.class)) {
            chatSubscriber.onMessage(redisMessage(RedisKeys.FANOUT_CHANNEL, chatEcho), null);
            eventSubscriber.onMessage(redisMessage(RedisKeys.EVENT_FANOUT_CHANNEL, eventEcho), null);
            chatSubscriber.onMessage(redisMessage(RedisKeys.FANOUT_CHANNEL, "{\"originInstanceId\":"), null);

            assertThat(MDC.getCopyOfContextMap()).isEqualTo(before);
            CapturedLogs.Line chatLine = single(logs.lines(event(LogContext.FANOUT_RECEIVE, "result=self_echo")
                    .and(line -> messageId.toString().equals(line.get("message_id")))));
            assertThat(chatLine.get("origin_request_id")).isEqualTo("req-echo");
            CapturedLogs.Line eventLine = single(logs.lines(event(LogContext.FANOUT_RECEIVE, "result=self_echo")
                    .and(line -> eventId.toString().equals(line.get("event_id")))));
            assertThat(eventLine.get("origin_request_id")).isEqualTo("req-echo-evt");
            assertThat(eventLine.get("message_id")).as("바깥 문맥 중 건드리지 않은 키는 그대로 보인다").isEqualTo("outer-msg");
            assertThat(logs.lines(event(LogContext.FANOUT_RECEIVE, "result=invalid"))).hasSize(1);
            assertThat(logs.lines(line -> line.message().contains("메아리"))).as("채팅 본문은 로그에 없다").isEmpty();
        }
        assertThat(eventDelivery.mayReceive(eventId, alice)).as("메아리는 수신 집합도 다시 기록하지 않는다").isFalse();
    }

    @Test
    @DisplayName("chat:fanout — telemetry 모양이 깨져도 채팅은 로컬 구독자에게 전달되고, 메타데이터만 버려진다")
    void brokenChatTelemetryStillDeliversTheMessage() throws Exception {
        StompSession session = connect();
        BlockingQueue<String> raw = subscribeRaw(session, "/topic/groups/" + island);
        try (CapturedLogs logs = CapturedLogs.of(ChatFanoutSubscriber.class)) {
            for (String telemetry : BROKEN_TELEMETRY) {
                UUID messageId = UUID.randomUUID();
                String wire = "{\"originInstanceId\":\"" + UUID.randomUUID() + "\",\"message\":" + chatJson(messageId)
                        + ",\"telemetry\":" + telemetry + "}";
                assertThat(objectMapper.readValue(wire, ChatFanoutEvent.class).telemetry()).as(telemetry).isNull();

                JsonNode heard = publishUntilHeard(RedisKeys.FANOUT_CHANNEL, wire, raw, "messageId", messageId);
                assertThat(keysOf(heard)).as(telemetry).isEqualTo(CHAT_KEYS);
                CapturedLogs.Line line = logs.await(event(LogContext.FANOUT_RECEIVE, "result=delivered")
                        .and(l -> messageId.toString().equals(l.get("message_id"))), 1, TIMEOUT_MILLIS).get(0);
                assertThat(line.mdc()).as(telemetry).doesNotContainKeys("origin_request_id", "origin_trace_id");
            }
            assertThat(logs.lines(event(LogContext.FANOUT_RECEIVE, "result=invalid"))).isEmpty();
        }
    }

    @Test
    @DisplayName("chat:events:v1 — telemetry 모양이 깨져도 섬 사건은 로컬 전달되고 세션 폐기는 펜스에 적용된다")
    void brokenEventTelemetryStillDeliversAndRevokes() throws Exception {
        StompSession session = connect();
        BlockingQueue<String> raw = subscribeRaw(session, "/topic/islands/" + island + "/emotes");
        try (CapturedLogs logs = CapturedLogs.of(RealtimeEventFanoutSubscriber.class)) {
            for (String telemetry : BROKEN_TELEMETRY) {
                UUID eventId = UUID.randomUUID();
                String islandWire = emoteWireRaw(eventId, Set.of(alice), telemetry);
                assertThat(objectMapper.readValue(islandWire, RealtimeEventFanoutEvent.class).telemetry()).as(telemetry)
                        .isNull();
                JsonNode heard = publishUntilHeard(RedisKeys.EVENT_FANOUT_CHANNEL, islandWire, raw, "eventId", eventId);
                assertThat(keysOf(heard)).as(telemetry).isEqualTo(EVENT_KEYS);
                CapturedLogs.Line line = logs.await(event(LogContext.FANOUT_RECEIVE, "result=delivered")
                        .and(l -> eventId.toString().equals(l.get("event_id"))), 1, TIMEOUT_MILLIS).get(0);
                assertThat(line.mdc()).as(telemetry).doesNotContainKeys("origin_request_id", "origin_trace_id");

                UUID sid = UUID.randomUUID();
                String revokeWire = "{\"originInstanceId\":\"" + UUID.randomUUID() + "\",\"recipients\":[]"
                        + ",\"revokedUserId\":\"" + UUID.randomUUID() + "\",\"revokedSessionId\":\"" + sid
                        + "\",\"revokedUntil\":\"" + Instant.now().plusSeconds(3600) + "\",\"telemetry\":" + telemetry
                        + "}";
                eventSubscriber.onMessage(redisMessage(RedisKeys.EVENT_FANOUT_CHANNEL, revokeWire), null);
                assertThat(chatUserFence.isRevoked(sid)).as(telemetry).isTrue();
            }
            assertThat(logs.lines(event(LogContext.FANOUT_RECEIVE, "result=invalid"))).isEmpty();
            assertThat(logs.lines(event(LogContext.FANOUT_RECEIVE, "result=failed"))).isEmpty();
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private ExecutorSubscribableChannel outboundChannel() {
        return context.getBean("clientOutboundChannel", ExecutorSubscribableChannel.class);
    }

    /**
     * 실행기의 모든 스레드에서 한 번씩 MDC 를 본다 — 장벽으로 작업 수 = 스레드 수를 동시에 붙잡아 각 스레드가 하나씩 돈다.
     * 앞선 프레임을 처리한 스레드가 문맥을 되돌렸는지 보는 것이다(실행기 장식기를 타지 않는 일반 작업).
     */
    private void assertNoAppContextLeftOn(String executorBean) throws InterruptedException {
        ThreadPoolTaskExecutor executor = context.getBean(executorBean, ThreadPoolTaskExecutor.class);
        int threads = executor.getMaxPoolSize();
        CyclicBarrier barrier = new CyclicBarrier(threads);
        CountDownLatch done = new CountDownLatch(threads);
        List<Map<String, String>> seen = new CopyOnWriteArrayList<>();
        for (int i = 0; i < threads; i++) {
            executor.execute(() -> {
                try {
                    barrier.await(10, TimeUnit.SECONDS);
                    Map<String, String> mdc = MDC.getCopyOfContextMap();
                    seen.add(mdc == null ? Map.of() : mdc);
                } catch (Exception e) {
                    seen.add(Map.of("failure", e.getClass().getSimpleName()));
                } finally {
                    done.countDown();
                }
            });
        }
        assertThat(done.await(15, TimeUnit.SECONDS)).isTrue();
        assertThat(seen).as(executorBean).hasSize(threads)
                .allSatisfy(mdc -> assertThat(mdc).doesNotContainKeys(APP_KEYS).doesNotContainKey("failure"));
    }

    private StompSession connect() throws Exception {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", aliceBearer);
        return stompClient.connectAsync("ws://localhost:" + port + "/ws/chat", new WebSocketHttpHeaders(), headers,
                new StompSessionHandlerAdapter() {
                }).get(15, TimeUnit.SECONDS);
    }

    private static BlockingQueue<String> subscribeRaw(StompSession session, String destination) {
        BlockingQueue<String> queue = new LinkedBlockingQueue<>();
        session.subscribe(destination, new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return byte[].class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                queue.add(new String((byte[]) payload, StandardCharsets.UTF_8));
            }
        });
        return queue;
    }

    /** 구독 등록 경합을 «버리는 말»로 없앤 뒤 진짜 말을 보내 그 원문을 돌려준다(TwoInstanceFanoutTest 와 같은 방식). */
    private JsonNode sendChatUntilHeard(StompSession session, BlockingQueue<String> raw) throws Exception {
        for (int attempt = 0; attempt < 30; attempt++) {
            sendChat(session, UUID.randomUUID());
            if (raw.poll(500, TimeUnit.MILLISECONDS) != null) {
                break;
            }
        }
        UUID clientMessageId = UUID.randomUUID();
        sendChat(session, clientMessageId);
        long deadline = System.currentTimeMillis() + TIMEOUT_MILLIS;
        while (System.currentTimeMillis() < deadline) {
            String frame = raw.poll(200, TimeUnit.MILLISECONDS);
            if (frame != null && frame.contains(clientMessageId.toString())) {
                return objectMapper.readTree(frame);
            }
        }
        throw new AssertionError("보낸 말이 끝내 돌아오지 않았다");
    }

    private void sendChat(StompSession session, UUID clientMessageId) {
        StompHeaders headers = new StompHeaders();
        headers.setDestination("/app/groups/" + island + "/send");
        headers.setContentType(MimeTypeUtils.APPLICATION_JSON);
        session.send(headers, ("{\"content\":\"로그 연결\",\"clientMessageId\":\"" + clientMessageId + "\"}")
                .getBytes(StandardCharsets.UTF_8));
    }

    private JsonNode publishUntilHeard(String channel, String wire, BlockingQueue<String> raw, String idField,
            UUID id) throws Exception {
        return objectMapper.readTree(publishUntilHeardRaw(channel, wire, raw, idField, id));
    }

    /** Pub/Sub 는 저장하지 않아 구독 등록 전에 흘린 것은 사라진다 — 도착할 때까지 다시 흘린다. */
    private String publishUntilHeardRaw(String channel, String wire, BlockingQueue<String> raw, String idField,
            UUID id) throws Exception {
        for (int attempt = 0; attempt < 30; attempt++) {
            redis.convertAndSend(channel, wire);
            long deadline = System.currentTimeMillis() + 500;
            while (System.currentTimeMillis() < deadline) {
                String frame = raw.poll(100, TimeUnit.MILLISECONDS);
                if (frame != null && id.toString().equals(objectMapper.readTree(frame).path(idField).stringValue())) {
                    raw.clear();
                    return frame;
                }
            }
        }
        throw new AssertionError("Redis 로 흘린 것이 소켓까지 오지 않았다 — " + channel);
    }

    private String chatJson(UUID messageId) {
        return objectMapper.writeValueAsString(new ChatMessageResponse(messageId, island, UUID.randomUUID(),
                "옆 인스턴스", Instant.parse("2026-10-29T00:00:00Z"), UUID.randomUUID()));
    }

    private RealtimeEventEnvelope emote(UUID eventId) {
        Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        var payload = objectMapper.createObjectNode();
        payload.put("userId", alice.toString());
        payload.put("sessionId", UUID.randomUUID().toString());
        payload.put("type", "cheer");
        payload.put("expiresAt", now.plusSeconds(3).toString());
        return new RealtimeEventEnvelope(eventId, RealtimeEventType.FOCUS_EMOTE, island, null, now, payload);
    }

    /** 다른 인스턴스가 흘린 응원 — {@code origin} 이 null 이면 telemetry 키가 아예 없는 옛 발행자 원문. */
    private String emoteWire(UUID eventId, Set<UUID> recipients, String origin) {
        return emoteWireRaw(eventId, recipients, origin == null ? null
                : "{\"v\":1,\"originRequestId\":\"" + origin + "\",\"eventId\":\"" + eventId + "\"}");
    }

    /** {@code telemetryJson} 을 원문 그대로 싣는다 — null 이면 키가 없다. */
    private String emoteWireRaw(UUID eventId, Set<UUID> recipients, String telemetryJson) {
        String recipientsJson = recipients.stream().map(id -> "\"" + id + "\"").collect(Collectors.joining(","));
        String telemetry = telemetryJson == null ? "" : ",\"telemetry\":" + telemetryJson;
        return "{\"originInstanceId\":\"" + UUID.randomUUID() + "\",\"destination\":\"/topic/islands/" + island
                + "/emotes\",\"event\":" + objectMapper.writeValueAsString(emote(eventId)) + ",\"recipients\":["
                + recipientsJson + "]" + telemetry + "}";
    }

    private static DefaultMessage redisMessage(String channel, String body) {
        return new DefaultMessage(channel.getBytes(StandardCharsets.UTF_8), body.getBytes(StandardCharsets.UTF_8));
    }

    private static Set<String> keysOf(JsonNode node) {
        return new HashSet<>(node.propertyNames());
    }

    private static CapturedLogs.Line single(List<CapturedLogs.Line> lines) {
        assertThat(lines).hasSize(1);
        return lines.get(0);
    }
}

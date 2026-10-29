package com.oneorthree.realtime;

import com.oneorthree.realtime.event.InboundAcceptLog;
import com.oneorthree.realtime.event.RealtimeEventDelivery;
import com.oneorthree.realtime.event.RealtimeEventFanoutSubscriber;
import com.oneorthree.realtime.fanout.ChatFanout;
import com.oneorthree.realtime.fanout.ChatFanoutSubscriber;
import com.oneorthree.realtime.logging.CapturedLogs;
import com.oneorthree.realtime.logging.LogContext;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.dto.ChatMessageResponse;
import com.oneorthree.realtime.message.dto.SendMessageRequest;
import com.zaxxer.hikari.HikariDataSource;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.lang.NonNull;
import org.springframework.messaging.converter.CompositeMessageConverter;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.converter.SimpleMessageConverter;
import org.springframework.messaging.support.ExecutorSubscribableChannel;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.lang.reflect.Type;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * <b>인스턴스 두 대</b>가 서로의 말을 듣는지 — 이 서비스의 스케일아웃 주장 전체가 여기 걸려 있다.
 *
 * <p>STOMP 의 기본 브로커({@code SimpleBroker})는 <b>프로세스 안의 구독자만</b> 안다. 그래서 인스턴스를
 * 두 대로 늘리는 순간 A 에 붙은 사람과 B 에 붙은 사람은 서로의 말을 못 듣는데, <b>그 고장은 인스턴스가
 * 한 대인 개발·CI 에서는 절대 재현되지 않는다.</b> 운영에서 스케일아웃한 날에야 드러난다.
 *
 * <p>다른 테스트들은 그 경로의 «절반씩»만 본다 — {@code ChatFanoutTest} 는 발행이 나가는지를(목),
 * {@code ChatWebSocketIntegrationTest} 는 남이 흘린 것을 받는지를(손으로 만든 이벤트) 본다. 둘이
 * 만나는 지점(직렬화 형식, 채널 이름, 자기 메아리 필터)은 어느 쪽도 확인하지 못한다. 여기서는
 * <b>두 번째 애플리케이션 컨텍스트를 실제로 띄워</b> 같은 Redis·같은 DB 를 보게 하고, A 로 보낸 말이
 * B 에 붙은 소켓에 도착하는지를 본다.
 *
 * <p>두 컨텍스트가 같은 저장소를 보게 하려고 컨테이너 접속 정보를 <b>빈에서 읽어</b> 두 번째 인스턴스에
 * 속성으로 넘긴다({@code @ServiceConnection} 은 속성이 아니라 빈으로 주입하기 때문에 그대로는 물려줄 수 없다).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class TwoInstanceFanoutTest {

    private static final long TIMEOUT_SECONDS = 20;

    @LocalServerPort
    private int portA;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private LettuceConnectionFactory redisConnectionFactory;

    @Autowired
    private org.springframework.data.redis.core.StringRedisTemplate redis;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RealtimeEventDelivery eventDeliveryA;

    @Value("${realtime.internal.data-service-token}")
    private String dataToken;

    /**
     * 두 인스턴스가 «각자» 상류를 부른다. 이쪽 목은 A 의 것이고, B 에는 아래에서 자기 목을 심는다 —
     * 그래야 B 도 구독 인가를 통과한다.
     */
    @MockitoBean
    private GroupClient groupClient;

    /** 차단 필터(GROMO-2182)는 fail-closed 라 상류가 없으면 남의 말이 전부 막힌다 — 목의 기본값(빈 집합)으로 «차단 없음». */
    @MockitoBean
    private com.oneorthree.realtime.block.client.BlockClient blockClient;

    private ConfigurableApplicationContext instanceB;
    private int portB;
    private WebSocketStompClient stompClient;

    /** 스텁 빈이 읽어야 해서 static 이다 — 컨텍스트 B 는 이 인스턴스를 모른다. */
    private static volatile UUID sharedIsland;

    /** B 의 친구 조회 스텁이 돌려줄 친구(바다 방 배정 우선순위, GROMO-2300). */
    private static volatile UUID sharedFriend;

    private UUID island;
    private UUID alice;
    private UUID bob;
    private String aliceBearer;
    private String bobBearer;

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        sharedIsland = island;
        alice = UUID.randomUUID();
        bob = UUID.randomUUID();
        aliceBearer = bearerOf(alice);
        bobBearer = bearerOf(bob);

        given(groupClient.fetchMyGroupIds(aliceBearer)).willReturn(GroupClient.Membership.of(Set.of(island)));
        given(groupClient.fetchMyGroupIds(bobBearer)).willReturn(GroupClient.Membership.of(Set.of(island)));

        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));

        instanceB = startSecondInstance();
        portB = Integer.parseInt(instanceB.getEnvironment().getRequiredProperty("local.server.port"));
    }

    @AfterEach
    void tearDown() {
        stompClient.stop();
        if (instanceB != null) {
            instanceB.close();
        }
    }

    @Test
    @DisplayName("A 에서 보낸 말이 B 에 붙은 사람에게 도착한다 — 인스턴스 한 대에선 절대 재현되지 않는 고장")
    void messageCrossesInstances() throws Exception {
        // 두 «프로세스»여야 의미가 있다. 포트가 같으면 A 와 B 가 한 인스턴스라 이 테스트는 아무것도
        // 증명하지 못한다 — 실제로 속성 우선순위 때문에 그렇게 된 적이 있어서 단언으로 못 박는다.
        assertThat(portB).isNotEqualTo(portA);

        StompSession onA = connect(portA, aliceBearer);
        StompSession onB = connect(portB, bobBearer);
        BlockingQueue<ChatMessageResponse> heardOnB = subscribe(onB, island);
        // 같은 JVM 의 두 컨텍스트가 한 logback 을 쓴다 — B 가 뜬 «뒤»에 붙인다(로깅 초기화가 appender 를 뗀다).
        CapturedLogs logs = CapturedLogs.of(ChatFanout.class, ChatFanoutSubscriber.class);

        // 구독 등록과 발신 사이의 경합은 «버리는 말»로 없앤다. 재전송으로는 안 된다 — 서버가 같은
        // clientMessageId 의 재전송을 다시 방송하지 않으므로(중복 도착 방지), 첫 발신이 등록 전에
        // 나가면 그 뒤 몇 번을 보내도 건너편엔 영원히 도착하지 않는다.
        for (int attempt = 0; attempt < 30; attempt++) {
            onA.send("/app/groups/" + island + "/send",
                    new SendMessageRequest("구독 등록 확인용", UUID.randomUUID()));
            if (heardOnB.poll(500, TimeUnit.MILLISECONDS) != null) {
                heardOnB.clear();
                break;
            }
        }

        UUID clientMessageId = UUID.randomUUID();
        onA.send("/app/groups/" + island + "/send",
                new SendMessageRequest("건너편 인스턴스에 들리나요", clientMessageId));

        // «그 키»가 올 때까지 기다린다 — 그냥 하나 꺼내면 등록 확인용으로 흘린 말 중 뒤늦게 도착한
        // 것이 잡힌다(등록 확인 루프는 첫 도착에 멈추지만 그때 이미 보낸 나머지가 남아 있다).
        ChatMessageResponse received = null;
        long deadline = System.currentTimeMillis() + 10_000L;
        while (received == null && System.currentTimeMillis() < deadline) {
            ChatMessageResponse candidate = heardOnB.poll(200, TimeUnit.MILLISECONDS);
            if (candidate != null && clientMessageId.equals(candidate.clientMessageId())) {
                received = candidate;
            }
        }

        assertThat(received).as("frameErrors=%s", frameErrors).isNotNull();
        assertThat(received.content()).isEqualTo("건너편 인스턴스에 들리나요");
        assertThat(received.senderId()).isEqualTo(alice);
        assertThat(received.groupId()).isEqualTo(island);
        // 건너편이 받은 것이 «그 말»이지 등록 확인용이 아니다.
        assertThat(received.clientMessageId()).isEqualTo(clientMessageId);

        // 로그 연결(GROMO-2559) — 발행은 A 만 하고, 같은 message_id 의 수신은 A 의 메아리 하나·B 의 전달 하나다.
        try (logs) {
            String messageId = received.messageId().toString();
            List<CapturedLogs.Line> published = logs.await(CapturedLogs.event(LogContext.FANOUT_PUBLISH, "chat:fanout")
                    .and(line -> messageId.equals(line.get("message_id"))), 1, 5_000);
            assertThat(published).hasSize(1);
            String requestId = published.get(0).get("request_id");
            assertThat(requestId).as("A 의 STOMP 프레임 request_id").isNotNull();
            List<CapturedLogs.Line> deliveredOnB = logs.await(CapturedLogs.event(LogContext.FANOUT_RECEIVE,
                    "result=delivered").and(line -> messageId.equals(line.get("message_id"))), 1, 5_000);
            assertThat(deliveredOnB).hasSize(1);
            assertThat(deliveredOnB.get(0).get("origin_request_id")).isEqualTo(requestId);
            assertThat(logs.await(CapturedLogs.event(LogContext.FANOUT_RECEIVE, "result=self_echo")
                    .and(line -> messageId.equals(line.get("message_id"))), 1, 5_000)).hasSize(1);
        }
    }

    @Test
    @DisplayName("A 의 Data 수신구로 들어온 섬 사건이 B 의 구독자·전달 직전 자리까지 같은 event_id·원인으로 이어진다 — chat:events:v1 (GROMO-2559)")
    void islandEventCrossesInstancesWithItsOrigin() throws Exception {
        assertThat(portB).isNotEqualTo(portA);
        assertThat(instanceB.getBean(RealtimeEventDelivery.class).instanceId())
                .as("두 인스턴스 — 메아리 판정의 근거").isNotEqualTo(eventDeliveryA.instanceId());
        WebSocketStompClient rawClient = new WebSocketStompClient(new StandardWebSocketClient());
        rawClient.setMessageConverter(new SimpleMessageConverter()); // 원문 그대로 — 매퍼가 모르는 키를 버리면 누출을 못 잡는다
        String topic = "/topic/islands/" + island + "/focus";
        try (CapturedLogs logs = CapturedLogs.of(InboundAcceptLog.class, RealtimeEventDelivery.class,
                RealtimeEventFanoutSubscriber.class);
                OutboundSeat seatB = OutboundSeat.attach(
                        instanceB.getBean("clientOutboundChannel", ExecutorSubscribableChannel.class), topic)) {
            StompHeaders auth = new StompHeaders();
            auth.add("Authorization", bobBearer);
            StompSession onB = rawClient.connectAsync("ws://localhost:" + portB + "/ws/chat",
                    new WebSocketHttpHeaders(), auth, new StompSessionHandlerAdapter() {
                    }).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            BlockingQueue<String> rawOnB = new LinkedBlockingQueue<>();
            onB.subscribe(topic, new StompFrameHandler() {
                @Override
                public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                    return byte[].class;
                }

                @Override
                public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                    rawOnB.add(new String((byte[]) payload, StandardCharsets.UTF_8));
                }
            });

            // 구독 등록 경합 — 새 eventId 로 다시 보내 «그 사건»이 B 에 도착할 때까지.
            String eventId = null;
            String frame = null;
            HttpClient http = HttpClient.newHttpClient();
            for (int attempt = 1; attempt <= 30 && frame == null; attempt++) {
                String candidate = UUID.randomUUID().toString();
                HttpResponse<String> response = http.send(HttpRequest.newBuilder(
                                URI.create("http://localhost:" + portA + "/internal/events"))
                        .header("Authorization", "Bearer " + dataToken).header("Content-Type", "application/json")
                        .header("X-Origin-Request-Id", "req-cross").header("X-Origin-Trace-Id", "987654321")
                        .header("X-Event-Id", candidate).header("X-Delivery-Id", "d-9").header("X-Attempt", "1")
                        .header("X-Trace-Context-Version", "1")
                        .POST(HttpRequest.BodyPublishers.ofString(focusMemberEvent(candidate, attempt))).build(),
                        HttpResponse.BodyHandlers.ofString());
                assertThat(response.statusCode()).isEqualTo(200);
                long deadline = System.currentTimeMillis() + 500;
                while (frame == null && System.currentTimeMillis() < deadline) {
                    String next = rawOnB.poll(100, TimeUnit.MILLISECONDS);
                    if (next != null && next.contains(candidate)) {
                        frame = next;
                        eventId = candidate;
                    }
                }
            }
            assertThat(frame).as("frameErrors=%s", frameErrors).isNotNull();
            String id = eventId;

            JsonNode envelope = objectMapper.readTree(frame);
            assertThat(new HashSet<>(envelope.propertyNames())).containsExactlyInAnyOrder("eventId", "schemaVersion",
                    "type", "islandId", "aggregateVersion", "occurredAt", "payload");
            assertThat(frame).doesNotContain("telemetry").doesNotContain("req-cross");
            CapturedLogs.Line accepted = logs.await(CapturedLogs.event(LogContext.CONSUMER_ACCEPT, "result=accepted")
                    .and(line -> id.equals(line.get("event_id"))), 1, 5_000).get(0);
            assertThat(accepted.mdc()).containsEntry("origin_request_id", "req-cross")
                    .containsEntry("delivery_id", "d-9").containsEntry("attempt", "1");
            assertThat(logs.await(CapturedLogs.event(LogContext.FANOUT_PUBLISH, "chat:events:v1")
                    .and(line -> id.equals(line.get("event_id"))), 1, 5_000)).hasSize(1)
                    .allSatisfy(line -> assertThat(line.get("origin_request_id")).isEqualTo("req-cross"));
            List<CapturedLogs.Line> deliveredOnB = logs.await(CapturedLogs.event(LogContext.FANOUT_RECEIVE,
                    "result=delivered").and(line -> id.equals(line.get("event_id"))), 1, 5_000);
            assertThat(deliveredOnB).as("B 하나만 전달 — A 는 자기 메아리").hasSize(1);
            assertThat(deliveredOnB.get(0).mdc()).containsEntry("origin_request_id", "req-cross")
                    .containsEntry("origin_trace_id", "987654321")
                    .as("전달 행 id·시도는 그 서비스의 relay 값이라 wire 로 넘기지 않는다")
                    .doesNotContainKeys("delivery_id", "attempt", "request_id");
            assertThat(logs.await(CapturedLogs.event(LogContext.FANOUT_RECEIVE, "result=self_echo")
                    .and(line -> id.equals(line.get("event_id"))), 1, 5_000)).hasSize(1);
            assertThat(seatB.await("event_id", id)).containsEntry("origin_request_id", "req-cross")
                    .containsEntry("origin_trace_id", "987654321");
            assertThat(seatB.thread(id)).startsWith("realtime-outbound-");
        } finally {
            rawClient.stop();
        }
    }

    @Test
    @DisplayName("A 의 Data 수신구가 버린 origin(형식 오류·모르는 버전)은 팬아웃 telemetry 에서 지금 요청 ID 로 다시 올라가지 않는다 — B 의 수신 줄에 원인이 없고, origin 헤더가 없을 때만 X-Request-Id 가 원인이다 (GROMO-2562)")
    void droppedOriginIsNotPromotedAcrossInstances() throws Exception {
        assertThat(portB).isNotEqualTo(portA);
        try (CapturedLogs logs = CapturedLogs.of(RealtimeEventDelivery.class, RealtimeEventFanoutSubscriber.class)) {
            CapturedLogs.Line malformed = receivedOnB(logs, "cur-bad", Map.of("X-Origin-Request-Id", "bad#id"));
            CapturedLogs.Line unknown = receivedOnB(logs, "cur-ver",
                    Map.of("X-Origin-Request-Id", "req-v2", "X-Trace-Context-Version", "2"));
            CapturedLogs.Line absent = receivedOnB(logs, "cur-none", Map.of());

            assertThat(malformed.mdc()).as("형식이 틀린 origin").doesNotContainKey("origin_request_id");
            assertThat(unknown.mdc()).as("모르는 버전").doesNotContainKey("origin_request_id");
            assertThat(absent.mdc()).as("origin 헤더가 없으면 X-Request-Id 가 원인")
                    .containsEntry("origin_request_id", "cur-none");
            for (CapturedLogs.Line onB : List.of(malformed, unknown)) {
                String id = onB.get("event_id");
                assertThat(logs.await(CapturedLogs.event(LogContext.FANOUT_PUBLISH, "chat:events:v1")
                        .and(line -> id.equals(line.get("event_id"))), 1, 5_000))
                        .as("A 의 발행 줄엔 지금 요청 ID 가 있었다 — B 의 «원인 없음»은 요청 ID 가 비어서가 아니다")
                        .singleElement().extracting(line -> line.get("request_id")).isIn("cur-bad", "cur-ver");
            }
        }
    }

    /** A 의 Data 수신구로 섬 사건 하나를 보내고 B 의 수신 줄을 돌려준다 — B 의 Redis 구독이 늦을 수 있어 새 eventId 로 다시 보낸다. */
    private CapturedLogs.Line receivedOnB(CapturedLogs logs, String requestId, Map<String, String> carrier)
            throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        for (int attempt = 1; attempt <= 30; attempt++) {
            String eventId = UUID.randomUUID().toString();
            HttpRequest.Builder request = HttpRequest.newBuilder(
                            URI.create("http://localhost:" + portA + "/internal/events"))
                    .header("Authorization", "Bearer " + dataToken).header("Content-Type", "application/json")
                    .header("X-Request-Id", requestId);
            carrier.forEach(request::header);
            HttpResponse<String> response = http.send(
                    request.POST(HttpRequest.BodyPublishers.ofString(focusMemberEvent(eventId, attempt))).build(),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
            List<CapturedLogs.Line> delivered = logs.await(CapturedLogs.event(LogContext.FANOUT_RECEIVE,
                    "result=delivered").and(line -> eventId.equals(line.get("event_id"))), 1, 500);
            if (!delivered.isEmpty()) {
                return delivered.get(0);
            }
        }
        throw new AssertionError("A 로 보낸 사건이 B 에 도착하지 않았다");
    }

    /** Data outbox 정본 10필드 — {@code FocusMemberEvents#focusUpdated} 가 만드는 모양(IslandRealtimeIntegrationTest 와 같다). */
    private String focusMemberEvent(String eventId, long version) {
        return "{\"eventId\":\"" + eventId + "\",\"schemaVersion\":1,\"type\":\"focus.member.updated\","
                + "\"occurredAt\":\"2026-10-29T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + alice + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":" + version + ",\"params\":{\"userId\":\"" + alice + "\","
                + "\"sessionId\":\"" + UUID.randomUUID() + "\",\"status\":\"active\","
                + "\"subject\":\"영어 단어\",\"activeSeconds\":120,"
                + "\"serverNow\":\"2026-10-29T00:00:00Z\",\"sessionVersion\":3}}";
    }

    @Test
    @DisplayName("B 에서 바다에 들어온 사람의 joined 가 A 에 붙은 같은 방 구성원에게 도착한다 — chat:sea:v1 (GROMO-2300)")
    void seaRoomEventCrossesInstances() throws Exception {
        assertThat(portB).isNotEqualTo(portA);
        // alice 는 이미 방 R 에 있다(A 에 붙어 있다). bob 의 친구라 B 의 배정이 R 을 1순위로 고른다.
        UUID room = UUID.randomUUID();
        redis.opsForSet().add(com.oneorthree.realtime.common.redis.RedisKeys.seaRoomMembers(room), alice.toString());
        redis.opsForHash().putAll(com.oneorthree.realtime.common.redis.RedisKeys.seaUser(alice),
                java.util.Map.of("roomId", room.toString(), "state", "focusing"));
        redis.opsForSet().add(com.oneorthree.realtime.common.redis.RedisKeys.SEA_ROOMS_OPEN, room.toString());
        sharedFriend = alice;

        StompSession onA = connect(portA, aliceBearer);
        BlockingQueue<java.util.Map<String, Object>> heardOnA = new LinkedBlockingQueue<>();
        onA.subscribe("/topic/sea/rooms/" + room, new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return java.util.Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                heardOnA.add((java.util.Map<String, Object>) payload);
            }
        });
        StompSession onB = connect(portB, bobBearer);

        // 구독 등록과 입장 사이의 경합 — 못 받았으면 bob 이 나갔다가 다시 들어온다(재입장은 joined 를 내지 않으므로).
        java.util.Map<String, Object> joined = null;
        for (int attempt = 0; attempt < 20 && joined == null; attempt++) {
            redis.delete(com.oneorthree.realtime.common.redis.RedisKeys.seaEnterAttempt(bob));
            onB.send("/app/sea/enter", java.util.Map.of());
            long deadline = System.currentTimeMillis() + 1000L;
            while (joined == null && System.currentTimeMillis() < deadline) {
                java.util.Map<String, Object> frame = heardOnA.poll(200, TimeUnit.MILLISECONDS);
                if (frame != null && "sea.member.joined".equals(frame.get("type"))) {
                    joined = frame;
                }
            }
            if (joined == null) {
                onB.send("/app/sea/leave", java.util.Map.of());
            }
        }

        assertThat(joined).as("frameErrors=%s", frameErrors).isNotNull();
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> member = (java.util.Map<String, Object>)
                ((java.util.Map<String, Object>) joined.get("payload")).get("member");
        assertThat(member.get("userId")).isEqualTo(bob.toString());
        assertThat(joined.get("roomId")).isEqualTo(room.toString());

        // 퇴장도 같은 publish 경로(chat:sea:v1)로 건넌다. 반면 bob 의 다른 기기에 가는 /user/queue/sea 의
        // sea.room.left 는 «의도적으로» 인스턴스를 건너지 않는다(SeaRoomPublisher.publishToUser 의 ceiling) — 여기서 보지 않는다.
        onB.send("/app/sea/leave", java.util.Map.of());
        java.util.Map<String, Object> left = null;
        long deadline = System.currentTimeMillis() + 10_000L;
        while (left == null && System.currentTimeMillis() < deadline) {
            java.util.Map<String, Object> frame = heardOnA.poll(200, TimeUnit.MILLISECONDS);
            if (frame != null && "sea.member.left".equals(frame.get("type"))) {
                left = frame;
            }
        }
        assertThat(left).as("frameErrors=%s", frameErrors).isNotNull();
        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> leftPayload = (java.util.Map<String, Object>) left.get("payload");
        assertThat(leftPayload.get("userId")).isEqualTo(bob.toString());
        assertThat(leftPayload.get("reason")).isEqualTo("left");
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /**
     * 두 번째 인스턴스를 같은 JVM 안에 띄운다.
     *
     * <p>Testcontainers 를 다시 띄우지 않고 <b>같은 컨테이너</b>를 보게 하는 것이 핵심이다 — 그래야
     * 「같은 Redis 를 공유하는 두 프로세스」라는 운영 구도가 된다. 접속 정보는 컨텍스트 A 의 빈에서
     * 꺼낸다({@code @ServiceConnection} 이 속성을 남기지 않으므로 환경 복사로는 안 된다).
     */
    private ConfigurableApplicationContext startSecondInstance() {
        HikariDataSource hikari = (HikariDataSource) dataSource;
        return new SpringApplicationBuilder(RealtimeApplication.class)
                .profiles("ci")
                .sources(StubUpstream.class)
                // ⚠️ 값은 «커맨드라인 인자»로 넘긴다. SpringApplicationBuilder.properties() 는
                //    setDefaultProperties 로 들어가 «가장 낮은 우선순위»라, application.yml 의
                //    server.port: 8081 에 그대로 밀린다 — 실제로 그렇게 두 인스턴스가 같은 포트를
                //    잡으려 들었고, 결국 A 와 B 가 «같은 프로세스»가 되어 테스트가 아무것도 증명하지
                //    못했다. 커맨드라인 인자는 yml 보다 높다.
                .run("--server.port=0",
                        // 관리 포트도 옮긴다 — 안 그러면 두 인스턴스가 같은 9091 을 잡으려 든다.
                        "--management.server.port=0",
                        "--spring.datasource.url=" + hikari.getJdbcUrl(),
                        "--spring.datasource.username=" + hikari.getUsername(),
                        "--spring.datasource.password=" + hikari.getPassword(),
                        "--spring.data.redis.host=" + redisConnectionFactory.getHostName(),
                        "--spring.data.redis.port=" + redisConnectionFactory.getPort(),
                        // B 는 Flyway 를 다시 돌리지 않는다 — A 가 이미 만들었다.
                        "--spring.flyway.enabled=false");
    }

    /**
     * B 의 상류 스텁.
     *
     * <p>A 의 {@code @MockitoBean} 은 그 컨텍스트에만 있어서 B 는 자기 것을 갖고 있어야 구독 인가를
     * 통과한다. {@code registerSingleton} 으로 심으면 컴포넌트 스캔이 등록하는 진짜 빈과 «둘»이 되어
     * 어느 쪽이 주입될지 알 수 없다 — 실제로 진짜 빈이 주입돼 B 의 구독이 {@code UPSTREAM_UNAVAILABLE}
     * 로 거절됐다. {@code @Primary} 는 그 모호함을 결정적으로 없앤다.
     */
    // ⚠️ @SpringBootApplication 을 달면 안 된다. 그건 @SpringBootConfiguration 이기도 해서,
    //    @SpringBootTest 가 설정 클래스를 찾을 때 «후보가 둘»이 되어 이 패키지의 모든 통합 테스트가
    //    initializationError 로 깨진다(실제로 그렇게 6개가 한꺼번에 죽었다).
    //    @TestConfiguration 은 컴포넌트 스캔 대상이 아니라 그 사고가 구조적으로 불가능하다.
    @org.springframework.boot.test.context.TestConfiguration
    static class StubUpstream {

        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        GroupClient stubGroupClient(com.oneorthree.realtime.auth.JwtValidator jwtValidator) {
            return new GroupClient("http://localhost:1", 100, "test-realtime-to-data", jwtValidator) {
                @Override
                public Membership fetchMyGroupIds(String bearerToken) {
                    return Membership.of(Set.of(sharedIsland));
                }
            };
        }

        /** B 의 바다 상태 — 늘 항해 중(GROMO-2300). */
        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        com.oneorthree.realtime.sea.client.SeaStateClient stubSeaStateClient() {
            return new com.oneorthree.realtime.sea.client.SeaStateClient("http://localhost:1", "t", 100) {
                @Override
                public SeaState fetch(UUID userId) {
                    Instant now = Instant.now();
                    return new SeaState(null, null, new Session(UUID.randomUUID(), UUID.randomUUID(), 30, 0L, now,
                            now));
                }
            };
        }

        /** B 의 친구 조회 — {@link #sharedFriend} 하나. */
        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        com.oneorthree.realtime.sea.client.FriendsClient stubFriendsClient() {
            return new com.oneorthree.realtime.sea.client.FriendsClient("http://localhost:1", "t", 100) {
                @Override
                public Set<UUID> fetchFriendIds(UUID userId) {
                    return sharedFriend == null ? Set.of() : Set.of(sharedFriend);
                }
            };
        }

        /** B 의 차단 조회 — 차단 없음. fail-closed 필터가 A 에서 온 남의 말을 막지 않게 한다(GROMO-2182). */
        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        com.oneorthree.realtime.block.client.BlockClient stubBlockClient() {
            return new com.oneorthree.realtime.block.client.BlockClient("http://localhost:1", "t", 100) {
                @Override
                public Set<java.util.UUID> fetchBlockedIds(java.util.UUID userId) {
                    return Set.of();
                }
            };
        }
    }

    /**
     * 두 세션에 도착한 ERROR 프레임·예외를 모은다.
     *
     * <p>진단용이 아니라 <b>실패 메시지용</b>이다. 이 테스트가 깨질 때 「도착하지 않았다」만으로는
     * 원인을 알 수 없다 — 구독이 거절된 것인지(인가), 전파가 안 된 것인지(Redis), 아니면 두
     * 인스턴스가 실은 한 프로세스인지(포트). 실제로 이 큐가 {@code UPSTREAM_UNAVAILABLE} 을 보여 줘서
     * 「B 의 상류 스텁이 진짜 빈에 밀렸다」를 찾아냈다.
     */
    private final BlockingQueue<String> frameErrors = new LinkedBlockingQueue<>();

    private StompSession connect(int port, String bearer) throws Exception {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        return stompClient.connectAsync("ws://localhost:" + port + "/ws/chat",
                        new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() {
                            @Override
                            public Type getPayloadType(StompHeaders h) {
                                return byte[].class;
                            }

                            @Override
                            public void handleFrame(StompHeaders h, Object payload) {
                                frameErrors.add("FRAME port=" + port + " msg=" + h.getFirst("message"));
                            }

                            @Override
                            public void handleException(StompSession sess, org.springframework.messaging.simp.stomp.StompCommand cmd,
                                    StompHeaders h, byte[] payload, Throwable ex) {
                                frameErrors.add("EX port=" + port + " " + ex);
                            }
                        })
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private BlockingQueue<ChatMessageResponse> subscribe(StompSession session, UUID groupId) {
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

    private String bearerOf(UUID userId) {
        return "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }
}

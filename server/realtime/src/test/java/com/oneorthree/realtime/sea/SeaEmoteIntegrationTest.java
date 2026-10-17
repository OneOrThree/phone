package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.sea.client.FriendsClient;
import com.oneorthree.realtime.sea.client.SeaStateClient;
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
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 바다 방 이모트 발신 (GROMO-2300, 계약 §5) — 실 소켓·실 Redis. 방 소속은 Redis 에 직접 심는다(입장 배선은
 * {@code SeaRoomIntegrationTest} 가 본다). 방 토픽 등록은 RECEIPT 가 없어 «탐침 사건이 도착할 때까지 다시 발행»으로 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class SeaEmoteIntegrationTest {

    private static final long TIMEOUT_SECONDS = 15;

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private SeaRoomPublisher publisher;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private SeaRooms seaRooms;

    @MockitoBean
    private SeaStateClient seaState;

    @MockitoBean
    private FriendsClient friends;

    @MockitoBean
    private BlockClient blockClient;

    private WebSocketStompClient stompClient;
    private final UUID room = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));
    }

    @AfterEach
    void tearDown() {
        stompClient.stop();
    }

    @Test
    @DisplayName("같은 방 둘 — A 가 이모트를 보내면 B 의 방 토픽에 sea.emote{userId:A, type} 가 온다")
    void emoteReachesTheRoom() throws Exception {
        UUID a = member();
        UUID b = member();
        Client bob = connect(b);
        BlockingQueue<Map<String, Object>> heard = bob.watchRoom();
        Client alice = connect(a);

        alice.send("cheer");

        Map<String, Object> frame = await(heard, f -> "sea.emote".equals(f.get("type")));
        assertThat(payload(frame)).containsEntry("userId", a.toString()).containsEntry("type", "cheer");
    }

    @Test
    @DisplayName("방에 없는 사용자의 SEND → NOT_IN_SEA_ROOM, 방 토픽에는 프레임이 없다")
    void outsiderIsRejected() throws Exception {
        UUID b = member();
        Client bob = connect(b);
        BlockingQueue<Map<String, Object>> heard = bob.watchRoom();
        Client outsider = connect(UUID.randomUUID());
        BlockingQueue<SendFailureResponse> failures = outsider.errors();

        SendFailureResponse failure = outsider.sendUntilFailure(room, "cheer", failures);

        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.NOT_IN_SEA_ROOM.name());
        assertThat(heard.poll(1, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("5종 밖의 type → INVALID_EMOTE_TYPE, 방 토픽에는 프레임이 없고 성공 창도 소모하지 않는다")
    void unknownTypeIsRejected() throws Exception {
        UUID a = member();
        UUID b = member();
        Client bob = connect(b);
        BlockingQueue<Map<String, Object>> heard = bob.watchRoom();
        Client alice = connect(a);
        BlockingQueue<SendFailureResponse> failures = alice.errors();

        SendFailureResponse failure = alice.sendUntilFailure(room, "dance", failures);

        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.INVALID_EMOTE_TYPE.name());
        assertThat(heard.poll(1, TimeUnit.SECONDS)).isNull();
        assertThat(redis.hasKey(RedisKeys.seaEmoteRateLimit(room, a))).isFalse();
    }

    @Test
    @DisplayName("3초 안에 두 번 → 첫째는 방에 가고 둘째는 EMOTE_TOO_FREQUENT")
    void secondEmoteInsideTheWindowIsRejected() throws Exception {
        UUID a = member();
        UUID b = member();
        Client bob = connect(b);
        BlockingQueue<Map<String, Object>> heard = bob.watchRoom();
        Client alice = connect(a);
        BlockingQueue<SendFailureResponse> failures = alice.errors();

        alice.send("hello");
        await(heard, f -> "sea.emote".equals(f.get("type")));
        redis.delete(RedisKeys.seaEmoteAttempt(a)); // 시도 창(600ms)은 비우고 성공 창(3s)만 본다
        alice.send("hearts");

        SendFailureResponse failure = failures.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.EMOTE_TOO_FREQUENT.name());
        assertThat(heard.poll(1, TimeUnit.SECONDS)).as("둘째는 방에 가지 않는다").isNull();
    }

    @Test
    @DisplayName("수신자가 방을 나간 뒤 온 이모트는 받지 않는다 — 전달 직전 재검사")
    void leftMemberDoesNotReceiveLaterEmotes() throws Exception {
        UUID a = member();
        UUID b = member();
        Client bob = connect(b);
        BlockingQueue<Map<String, Object>> heard = bob.watchRoom();
        Client alice = connect(a);
        seaRooms.leaveCurrent(b, SeaRooms.LEFT);
        while (heard.poll(300, TimeUnit.MILLISECONDS) != null) {
            continue; // 퇴장 직전·직후 잔여를 비운다
        }

        alice.send("cheer");

        Map<String, Object> frame;
        while ((frame = heard.poll(1, TimeUnit.SECONDS)) != null) {
            assertThat(frame.get("type")).as("나간 사람에게 이모트가 가면 안 된다").isNotEqualTo("sea.emote");
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** 이 테스트 방의 구성원을 Redis 에 심는다 — 구독 관문과 {@code isMember} 가 보는 해시 {@code roomId}. */
    private UUID member() {
        UUID user = UUID.randomUUID();
        redis.opsForSet().add(RedisKeys.seaRoomMembers(room), user.toString());
        redis.opsForHash().putAll(RedisKeys.seaUser(user), Map.of("roomId", room.toString(), "state", "focusing"));
        return user;
    }

    private static Map<String, Object> await(BlockingQueue<Map<String, Object>> queue,
            Predicate<Map<String, Object>> wanted) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            Map<String, Object> frame = queue.poll(200, TimeUnit.MILLISECONDS);
            if (frame != null && wanted.test(frame)) {
                return frame;
            }
        }
        throw new AssertionError("기다린 방 사건이 끝내 오지 않았다");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> payload(Map<String, Object> frame) {
        return (Map<String, Object>) frame.get("payload");
    }

    private Client connect(UUID userId) throws Exception {
        String bearer = "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        Client client = new Client(userId);
        client.session = stompClient.connectAsync("ws://localhost:" + port + "/ws/realtime",
                new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() { })
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        return client;
    }

    private final class Client {

        private final UUID userId;
        private StompSession session;

        Client(UUID userId) {
            this.userId = userId;
        }

        /** 이모트 SEND — 600ms 시도 창은 비우고 보낸다(이 테스트가 보려는 건 성공 창·도메인 규칙이다). */
        void send(String type) {
            redis.delete(RedisKeys.seaEmoteAttempt(userId));
            session.send("/app/sea/rooms/" + room + "/emotes", Map.of("type", type));
        }

        BlockingQueue<SendFailureResponse> errors() throws Exception {
            BlockingQueue<SendFailureResponse> failures = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/errors", new StompFrameHandler() {
                @Override
                public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                    return SendFailureResponse.class;
                }

                @Override
                public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                    failures.add((SendFailureResponse) payload);
                }
            });
            return failures;
        }

        /** 구독 등록은 RECEIPT 가 없다 — 거절이 올 때까지 다시 보낸다(거절은 성공 창을 소모하지 않는다). */
        SendFailureResponse sendUntilFailure(UUID target, String type, BlockingQueue<SendFailureResponse> failures)
                throws InterruptedException {
            for (int attempt = 0; attempt < 30; attempt++) {
                redis.delete(RedisKeys.seaEmoteAttempt(userId));
                session.send("/app/sea/rooms/" + target + "/emotes", Map.of("type", type));
                SendFailureResponse failure = failures.poll(500, TimeUnit.MILLISECONDS);
                if (failure != null) {
                    return failure;
                }
            }
            throw new AssertionError("거절이 끝내 오지 않았다");
        }

        /** 방 토픽을 구독하고 탐침 사건이 도착할 때까지 다시 발행해 등록을 확인한 뒤, 탐침 잔여를 비운다. */
        BlockingQueue<Map<String, Object>> watchRoom() throws Exception {
            BlockingQueue<Map<String, Object>> queue = new LinkedBlockingQueue<>();
            session.subscribe("/topic/sea/rooms/" + room, new StompFrameHandler() {
                @Override
                public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                    return Map.class;
                }

                @Override
                @SuppressWarnings("unchecked")
                public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                    queue.add(new HashMap<>((Map<String, Object>) payload));
                }
            });
            for (int attempt = 0; attempt < 30; attempt++) {
                publisher.publish(room, "sea.probe", objectMapper.createObjectNode());
                if (queue.poll(500, TimeUnit.MILLISECONDS) != null) {
                    while (queue.poll(300, TimeUnit.MILLISECONDS) != null) {
                        continue;
                    }
                    return queue;
                }
            }
            throw new AssertionError("방 토픽 구독이 끝내 등록되지 않았다");
        }
    }
}

package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.focus.IslandFocusSessions;
import com.oneorthree.realtime.membership.client.GroupClient;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.connection.RedisConnection;
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

import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * 플래그를 옵트아웃(false — 기본은 ON)하면 이동은 Redis 를 전혀 타지 않는다(GROMO-2339 ⑥) — 구독·이동 한 바퀴 동안 PUBLISH
 * 0회, 소유자 키 없음, 릴레이 컨테이너·실행기 없음. false 를 명시해 이 경로를 고정한다(전용 컨텍스트).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "realtime.movement.multi-instance.enabled=false")
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class MovementMultiInstanceOffTest {

    private static final long TIMEOUT_MS = 15_000;

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private ApplicationContext context;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private MovementCluster cluster;

    @Autowired
    private MovementOwnership ownership;

    @Autowired
    private MeterRegistry meters;

    @MockitoBean
    private IslandFocusSessions focusSessions;

    @MockitoBean
    private GroupClient groupClient;

    @MockitoBean
    private BlockClient blockClient;

    private final WebSocketStompClient stompClient = new WebSocketStompClient(new StandardWebSocketClient());

    @AfterEach
    void tearDown() {
        stompClient.stop();
    }

    @Test
    @DisplayName("구독·intent 한 바퀴 동안 PUBLISH 0회·소유자 키 0·리스 0 — 릴레이 컨테이너와 실행기는 만들지도 않는다")
    void movementNeverTouchesRedisWhenTheFlagIsOff() throws Exception {
        UUID island = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        String bearer = bearerOf(user);
        given(groupClient.fetchMyGroupIds(bearer)).willReturn(GroupClient.Membership.of(Set.of(island)));
        long publishesBefore = publishCount();

        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        StompSession session = stompClient.connectAsync("ws://localhost:" + port + "/ws/realtime",
                new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() { })
                .get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        BlockingQueue<Map<String, Object>> moves = new LinkedBlockingQueue<>();
        session.subscribe("/topic/islands/" + island + "/movement", new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders h) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(@NonNull StompHeaders h, Object payload) {
                moves.add((Map<String, Object>) payload);
            }
        });
        assertThat(awaitType(moves, "FullState")).isNotNull();
        session.send("/app/islands/" + island + "/movement/intent",
                Map.of("commandSeq", 1, "navRevision", 1, "goalX", 39.5, "goalY", 45.5));
        assertThat(awaitType(moves, "PathAccepted")).as("현행 동작 그대로 이동한다").isNotNull();
        session.disconnect();

        assertThat(publishCount()).as("이동은 PUBLISH 하지 않는다").isEqualTo(publishesBefore);
        assertThat(redis.hasKey(RedisKeys.movementOwner(island))).isFalse();
        assertThat(redis.hasKey(RedisKeys.MOVEMENT_EPOCH)).isFalse();
        assertThat(ownership.leases()).isEmpty();
        assertThat(cluster.relayInExecutor()).as("릴레이 실행기를 만들지 않는다").isNull();
        assertThat(context.containsBean("movementRelayListenerContainer")).as("SUBSCRIBE 도 없다").isFalse();
        assertThat(meters.find("movement.relay.lag").timer().count()).isZero();
    }

    /** 이 컨텍스트의 Redis 가 처리한 PUBLISH 누적 수 — 이동 외에 이 테스트 동안 PUBLISH 하는 경로는 없다. */
    private long publishCount() {
        Properties stats;
        try (RedisConnection connection = redis.getRequiredConnectionFactory().getConnection()) {
            stats = connection.serverCommands().info("commandstats");
        }
        String line = stats == null ? null : stats.getProperty("cmdstat_publish");
        if (line == null) {
            return 0;
        }
        return Long.parseLong(line.replaceAll(".*calls=(\\d+).*", "$1"));
    }

    private static Map<String, Object> awaitType(BlockingQueue<Map<String, Object>> queue, String type)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS);
        while (true) {
            long left = deadline - System.nanoTime();
            Map<String, Object> message = left <= 0 ? null : queue.poll(left, TimeUnit.NANOSECONDS);
            if (message == null || type.equals(message.get("type"))) {
                return message;
            }
        }
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

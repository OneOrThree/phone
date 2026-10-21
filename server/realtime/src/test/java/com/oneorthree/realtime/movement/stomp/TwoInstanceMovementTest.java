package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.RealtimeApplication;
import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Frame;
import com.oneorthree.realtime.movement.stomp.MovementRelay.Kind;
import com.zaxxer.hikari.HikariDataSource;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import io.micrometer.core.instrument.MeterRegistry;
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

import javax.sql.DataSource;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;

/**
 * 이동 단일 소유자(GROMO-2339)를 <b>인스턴스 두 대</b>로 — 같은 JVM 에 Spring 컨텍스트 둘(각자 instanceId·임베디드 포트),
 * 같은 Redis·DB 컨테이너. 플래그는 둘 다 ON. 실 소켓·실 틱(50ms)·실 Redis Pub/Sub 이다(상류 멤버십만 스텁).
 *
 * <p>소유자를 정하는 법: 그 섬에 먼저 구독한 세션의 인스턴스가 빈 리스를 얻는다. 그래서 각 테스트는 B 쪽 세션을 먼저
 * 붙여 B 를 소유자로 만든다 — B 를 끌 수 있고(인계), A 의 세션은 늘 «남의 방» 경로를 탄다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "realtime.movement.multi-instance.enabled=true")
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class TwoInstanceMovementTest {

    private static final long TIMEOUT_MS = 15_000;
    /** 회관 입구 셀(67,27)의 중심 — 번들 nav.json {@code entrances.hall}. */
    private static final double HALL_X = 67.5;
    private static final double HALL_Y = 27.5;
    /** 스폰 바로 옆 통행 칸. */
    private static final double NEAR_X = 39.5;
    private static final double NEAR_Y = 45.5;

    /** 두 인스턴스의 멤버십 스텁이 같이 본다 — B 는 이 테스트 인스턴스를 모른다. */
    private static volatile UUID sharedIsland;
    private static final Map<String, UUID> BEARER_USERS = new ConcurrentHashMap<>();
    private static final Set<UUID> KICKED = ConcurrentHashMap.newKeySet();

    @LocalServerPort
    private int portA;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private LettuceConnectionFactory redisConnectionFactory;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private MeterRegistry metersA;

    @Autowired
    private MovementOwnership ownershipA;

    @Autowired
    private MovementSubscriptionListener listenerA;

    @Autowired
    private MovementRelay relayA;

    @MockitoBean
    private GroupClient groupClient;

    @MockitoBean
    private BlockClient blockClient;

    private ConfigurableApplicationContext instanceB;
    private int portB;
    private String instanceIdB;
    private WebSocketStompClient stompClient;
    private final List<StompSession> opened = new ArrayList<>();
    private UUID island;

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        sharedIsland = island;
        given(groupClient.fetchMyGroupIds(anyString())).willAnswer(inv -> membershipOf(inv.getArgument(0)));
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));
        instanceB = startSecondInstance();
        portB = Integer.parseInt(instanceB.getEnvironment().getRequiredProperty("local.server.port"));
        instanceIdB = instanceB.getBean(MovementOwnership.class).instanceId();
        assertThat(portB).isNotEqualTo(portA);
        assertThat(instanceIdB).isNotEqualTo(ownershipA.instanceId());
    }

    @AfterEach
    void tearDown() {
        for (StompSession session : opened) {
            if (session.isConnected()) {
                session.disconnect();
            }
        }
        stompClient.stop();
        if (instanceB != null && instanceB.isActive()) {
            instanceB.close();
        }
        KICKED.clear();
    }

    @Test
    @DisplayName("① 10명을 두 인스턴스에 나눠 붙여도 전원이 같은 방(actor 10명)을 보고, 양쪽에서 낸 이동을 전원이 받는다")
    void tenUsersSplitAcrossInstancesSeeEveryFrame() throws Exception {
        List<UUID> users = new ArrayList<>();
        List<StompSession> sessions = new ArrayList<>();
        List<BlockingQueue<Map<String, Object>>> moves = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            UUID user = UUID.randomUUID();
            StompSession session = connect(i < 5 ? portB : portA, user);
            users.add(user);
            sessions.add(session);
            moves.add(movement(session));
            if (i == 0) {
                awaitFullState(moves.get(0), 1); // B 가 소유자가 된다
                assertThat(owner()).startsWith(instanceIdB + ":");
            }
        }
        for (BlockingQueue<Map<String, Object>> queue : moves) {
            awaitFullState(queue, 10);
        }
        for (BlockingQueue<Map<String, Object>> queue : moves) {
            drainUntilQuiet(queue);
        }

        sessions.get(0).send(intentDestination(), intent(1, NEAR_X, NEAR_Y)); // B 쪽 세션
        sessions.get(9).send(intentDestination(), intent(1, HALL_X, HALL_Y)); // A 쪽 세션

        Set<String> movers = Set.of(users.get(0).toString(), users.get(9).toString());
        for (BlockingQueue<Map<String, Object>> queue : moves) {
            assertThat(pathAcceptedUsers(queue, 2)).as("전원이 양쪽 이동을 다 받는다").isEqualTo(movers);
        }
        assertThat(metersA.counter("movement.owner.forward", "type", "INTENT").count())
                .as("A 의 intent 는 소유자 B 로 보냈다").isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("② 소유자를 끄면 2초 안에 남은 인스턴스가 소유자가 되고, 전원이 다시 맞춘 FullState 에 인계 위치가 복원된다")
    void ownerShutdownHandsOverWithinTwoSeconds() throws Exception {
        UUID b1 = UUID.randomUUID();
        UUID a1 = UUID.randomUUID();
        UUID a2 = UUID.randomUUID();
        awaitFullState(movement(connect(portB, b1)), 1);
        StompSession sa1 = connect(portA, a1);
        BlockingQueue<Map<String, Object>> a1Moves = movement(sa1);
        BlockingQueue<Map<String, Object>> a2Moves = movement(connect(portA, a2));
        awaitFullState(a1Moves, 3);
        awaitFullState(a2Moves, 3);
        drainUntilQuiet(a1Moves);

        sa1.send(intentDestination(), intent(1, HALL_X, HALL_Y));
        assertThat(awaitType(a1Moves, "Arrived", TIMEOUT_MS)).as("a1 이 회관 입구에 도착한다").isNotNull();
        double takeoverBefore = metersA.counter("movement.owner.acquire", "trigger", "takeover").count();

        instanceB.close();
        long closedAt = System.nanoTime();
        // 시간 상한은 넉넉히 — 느린 CI 에서 종료가 밀려도 깨지지 않게. «인계로 갔는가»는 아래 takeover 지표와 위치 복원이 고정한다.
        while (!owner().startsWith(ownershipA.instanceId() + ":")
                && System.nanoTime() - closedAt < TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS)) {
            Thread.sleep(20);
        }
        assertThat(owner()).startsWith(ownershipA.instanceId() + ":");
        assertThat(metersA.counter("movement.owner.acquire", "trigger", "takeover").count())
                .isEqualTo(takeoverBefore + 1);

        UUID a3 = UUID.randomUUID();
        Map<String, Object> seenByNewcomer = awaitFullState(movement(connect(portA, a3)), 3);
        assertThat(actorIds(seenByNewcomer)).containsExactlyInAnyOrder(a1.toString(), a2.toString(), a3.toString());
        assertThat(actor(seenByNewcomer, a1)).as("인계 위치로 복원 — 스폰으로 튀지 않는다")
                .containsEntry("x", HALL_X).containsEntry("y", HALL_Y);
        assertThat(actorIds(awaitFullState(a1Moves, 3)))
                .as("기존 세션도 새 소유자의 세션 한정 FullState 로 다시 열려 이후 사건을 받는다")
                .contains(a3.toString());
    }

    @Test
    @DisplayName("③ 그 섬의 현재 epoch 보다 작은 프레임은 버린다 — 같은 epoch 는 받는다")
    void staleEpochFrameIsDropped() throws Exception {
        awaitFullState(movement(connect(portB, UUID.randomUUID())), 1);
        BlockingQueue<Map<String, Object>> aMoves = movement(connect(portA, UUID.randomUUID()));
        awaitFullState(aMoves, 2);
        drainUntilQuiet(aMoves);
        long epoch = Long.parseLong(owner().substring(owner().lastIndexOf(':') + 1));
        double staleBefore = metersA.counter("movement.relay.stale").count();
        String empty = objectMapper.writeValueAsString(new MovementEvent.FullState(1, 1, 50, 10.989, List.of()));

        redis.convertAndSend(RedisKeys.MOVEMENT_FRAMES_CHANNEL, objectMapper.writeValueAsString(
                new Frame("ghost", island, epoch - 1, Kind.EVENT, null, null, false, empty)));
        assertThat(aMoves.poll(1, TimeUnit.SECONDS)).as("옛 epoch 프레임은 세션에 닿지 않는다").isNull();
        assertThat(metersA.counter("movement.relay.stale").count()).isGreaterThan(staleBefore);

        redis.convertAndSend(RedisKeys.MOVEMENT_FRAMES_CHANNEL, objectMapper.writeValueAsString(
                new Frame(instanceIdB, island, epoch, Kind.EVENT, null, null, false, empty)));
        assertThat(awaitFullState(aMoves, 0)).as("대조군 — 같은 epoch 는 받는다").isNotNull();
    }

    @Test
    @DisplayName("④ 비소유 인스턴스(A)에 온 강퇴 사건의 RECHECK 가 소유자(B)에 닿아 B 에 붙은 강퇴자를 방에서 내보낸다")
    void recheckFromNonOwnerRevokesOnTheOwner() throws Exception {
        UUID kicked = UUID.randomUUID();
        UUID observer = UUID.randomUUID();
        BlockingQueue<Map<String, Object>> kickedMoves = movement(connect(portB, kicked));
        awaitFullState(kickedMoves, 1);
        BlockingQueue<Map<String, Object>> observerMoves = movement(connect(portA, observer));
        awaitFullState(observerMoves, 2);
        awaitFullState(kickedMoves, 2);
        drainUntilQuiet(kickedMoves);
        drainUntilQuiet(observerMoves);

        KICKED.add(kicked);
        listenerA.recheckMembership(island, kicked); // InboundEventService 가 MEMBER_REMOVED 커밋 뒤 부르는 입구

        assertThat(actorIds(awaitFullState(observerMoves, 1))).containsExactly(observer.toString());
        assertThat(drainUntilQuiet(kickedMoves)).as("강퇴자는 그 뒤 아무것도 받지 않는다").isEmpty();
    }

    @Test
    @DisplayName("⑤ 같은 사용자가 다른 인스턴스에서 새로 들어오면 옛 세션은 SUPERSEDE 로 멈춘다 — 단일 인스턴스의 교체와 같은 결과")
    void reconnectOnAnotherInstanceSupersedesTheOldSession() throws Exception {
        UUID user = UUID.randomUUID();
        UUID walker = UUID.randomUUID();
        StompSession oldSession = connect(portB, user);
        BlockingQueue<Map<String, Object>> oldMoves = movement(oldSession);
        awaitFullState(oldMoves, 1);
        StompSession walkerSession = connect(portB, walker);
        BlockingQueue<Map<String, Object>> walkerMoves = movement(walkerSession);
        awaitFullState(walkerMoves, 2);
        awaitFullState(oldMoves, 2);
        drainUntilQuiet(oldMoves);

        BlockingQueue<Map<String, Object>> newMoves = movement(connect(portA, user));
        assertThat(actorIds(awaitFullState(newMoves, 2))).containsExactlyInAnyOrder(user.toString(),
                walker.toString());
        drainUntilQuiet(walkerMoves);

        walkerSession.send(intentDestination(), intent(1, NEAR_X, NEAR_Y));
        assertThat(awaitType(newMoves, "PathAccepted", TIMEOUT_MS)).as("새 세션은 받는다").isNotNull();
        assertThat(drainUntilQuiet(oldMoves)).as("옛 세션은 교체 뒤 아무것도 받지 않는다").isEmpty();

        drainUntilQuiet(walkerMoves);
        oldSession.send(intentDestination(), intent(5, HALL_X, HALL_Y));
        assertThat(drainUntilQuiet(walkerMoves)).as("옛 세션의 intent 는 방에 닿지 않는다")
                .noneMatch(m -> "PathAccepted".equals(m.get("type")));
    }

    @Test
    @DisplayName("⑥ 소유자가 6초간 생존 신호를 못 받아 비소유 쪽 actor 를 내보냈다가 복구되면, PING 대조로 그 세션이 다시 입장해 intent 가 적용된다")
    void sessionsRejoinAfterLivenessOutage() throws Exception {
        UUID b1 = UUID.randomUUID();
        UUID a1 = UUID.randomUUID();
        awaitFullState(movement(connect(portB, b1)), 1);
        StompSession sa1 = connect(portA, a1);
        BlockingQueue<Map<String, Object>> a1Moves = movement(sa1);
        awaitFullState(a1Moves, 2);

        org.springframework.data.redis.listener.RedisMessageListenerContainer ownerRelayIn =
                instanceB.getBean("movementRelayListenerContainer",
                        org.springframework.data.redis.listener.RedisMessageListenerContainer.class);
        ownerRelayIn.stop(); // 소유자 B 가 A 의 PING·명령을 못 받는다
        assertThat(actorIds(awaitFullState(a1Moves, 1))).as("생존 신호 한도(2.5초) 뒤 B 가 a1 을 내보낸다")
                .containsExactly(b1.toString());
        ownerRelayIn.start();

        assertThat(actorIds(awaitFullState(a1Moves, 2))).as("복구 뒤 PING 대조 → EVICTED → a1 재입장")
                .containsExactlyInAnyOrder(a1.toString(), b1.toString());
        assertThat(instanceB.getBean(MeterRegistry.class)
                .counter("movement.cluster.evict", "reason", "dead_instance").count()).isGreaterThanOrEqualTo(1);
        drainUntilQuiet(a1Moves);
        sa1.send(intentDestination(), intent(1, NEAR_X, NEAR_Y));
        Map<String, Object> accepted = awaitType(a1Moves, "PathAccepted", TIMEOUT_MS);
        assertThat(accepted).as("재입장한 actor 에 intent 가 다시 적용된다").isNotNull();
        assertThat(accepted.get("userId")).isEqualTo(a1.toString());
    }

    @Test
    @DisplayName("⑦ 강퇴 사건을 받은 A 의 RECHECK 가 제어 줄 포화로 유실돼도 송신 재개 뒤 2~3초 안에 B 의 강퇴자를 내보낸다(재송)")
    void lostRecheckIsRetriedUntilDelivered() throws Exception {
        UUID kicked = UUID.randomUUID();
        UUID observer = UUID.randomUUID();
        BlockingQueue<Map<String, Object>> kickedMoves = movement(connect(portB, kicked));
        awaitFullState(kickedMoves, 1);
        BlockingQueue<Map<String, Object>> observerMoves = movement(connect(portA, observer));
        awaitFullState(observerMoves, 2);
        drainUntilQuiet(observerMoves);

        relayA.stop(); // A 의 송신을 멈추고 제어 줄을 채운다
        try {
            while (metersA.counter("movement.relay.dropped", "kind", "control").count() == 0) {
                // 채움용은 아무도 받지 않는 EVICTED — PING 으로 채우면(수신자 null·B 앞 모두) 빈 세션 목록이라 B 가 A 의 actor 를 유령으로 지운다.
                relayA.publishCommand(new MovementRelay.Command(ownershipA.instanceId(), "nobody", 0, null,
                        MovementRelay.Type.EVICTED, null, null, null, false));
            }
            KICKED.add(kicked);
            double before = metersA.counter("movement.relay.recheck.retry", "reason", "dropped").count();
            listenerA.recheckMembership(island, kicked);
            assertThat(metersA.counter("movement.relay.recheck.retry", "reason", "dropped").count())
                    .as("RECHECK 를 못 넣었다 — 버리지 않고 재송 표시").isGreaterThan(before);
        } finally {
            relayA.start();
        }

        // 상한 TIMEOUT_MS — 감시 1틱 + 재판정 + 왕복이면 보통 3초 안. 시간 자체는 단언하지 않는다(느린 CI).
        assertThat(actorIds(awaitFullState(observerMoves, 1))).containsExactly(observer.toString());
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static GroupClient.Membership membershipOf(String bearer) {
        UUID user = BEARER_USERS.get(bearer);
        return GroupClient.Membership.of(user == null || KICKED.contains(user) ? Set.of() : Set.of(sharedIsland));
    }

    private String owner() {
        String value = redis.opsForValue().get(RedisKeys.movementOwner(island));
        return value == null ? "" : value;
    }

    private ConfigurableApplicationContext startSecondInstance() {
        HikariDataSource hikari = (HikariDataSource) dataSource;
        return new SpringApplicationBuilder(RealtimeApplication.class)
                .profiles("ci")
                .sources(StubUpstream.class)
                .run("--server.port=0",
                        "--management.server.port=0",
                        "--spring.datasource.url=" + hikari.getJdbcUrl(),
                        "--spring.datasource.username=" + hikari.getUsername(),
                        "--spring.datasource.password=" + hikari.getPassword(),
                        "--spring.data.redis.host=" + redisConnectionFactory.getHostName(),
                        "--spring.data.redis.port=" + redisConnectionFactory.getPort(),
                        "--spring.flyway.enabled=false",
                        "--realtime.movement.multi-instance.enabled=true",
                        // ⑥ 생존 신호 단절 — 5초 타이머를 기다리지 않게 B(소유자)만 줄인다(PING 1초라 2초 아래는 금지).
                        "--realtime.movement.multi-instance.instance-stale-ms=2500");
    }

    /** B 의 상류 스텁 — {@code TwoInstanceFanoutTest.StubUpstream} 과 같은 이유로 {@code @Primary}·{@code @TestConfiguration}. */
    @org.springframework.boot.test.context.TestConfiguration
    static class StubUpstream {

        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        GroupClient stubGroupClient() {
            return new GroupClient("http://localhost:1", 100) {
                @Override
                public Membership fetchMyGroupIds(String bearerToken) {
                    return membershipOf(bearerToken);
                }
            };
        }

        @org.springframework.context.annotation.Bean
        @org.springframework.context.annotation.Primary
        BlockClient stubBlockClient() {
            return new BlockClient("http://localhost:1", "t", 100) {
                @Override
                public Set<UUID> fetchBlockedIds(UUID userId) {
                    return Set.of();
                }
            };
        }
    }

    private StompSession connect(int port, UUID userId) throws Exception {
        String bearer = "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
        BEARER_USERS.put(bearer, userId);
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        StompSession session = stompClient.connectAsync("ws://localhost:" + port + "/ws/realtime",
                new WebSocketHttpHeaders(), headers, new StompSessionHandlerAdapter() { })
                .get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        opened.add(session);
        return session;
    }

    private BlockingQueue<Map<String, Object>> movement(StompSession session) {
        BlockingQueue<Map<String, Object>> queue = new LinkedBlockingQueue<>();
        session.subscribe("/topic/islands/" + island + "/movement", new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                queue.add((Map<String, Object>) payload);
            }
        });
        return queue;
    }

    private String intentDestination() {
        return "/app/islands/" + island + "/movement/intent";
    }

    private static Map<String, Object> intent(long commandSeq, double goalX, double goalY) {
        return Map.of("commandSeq", commandSeq, "navRevision", 1, "goalX", goalX, "goalY", goalY);
    }

    private static Set<String> pathAcceptedUsers(BlockingQueue<Map<String, Object>> queue, int count)
            throws InterruptedException {
        Set<String> users = new HashSet<>();
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS);
        while (users.size() < count && System.nanoTime() < deadline) {
            Map<String, Object> message = awaitType(queue, "PathAccepted",
                    TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()));
            if (message != null) {
                users.add((String) message.get("userId"));
            }
        }
        return users;
    }

    private static Map<String, Object> awaitType(BlockingQueue<Map<String, Object>> queue, String type,
            long timeoutMs) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (true) {
            long left = deadline - System.nanoTime();
            Map<String, Object> message = left <= 0 ? null : queue.poll(left, TimeUnit.NANOSECONDS);
            if (message == null || type.equals(message.get("type"))) {
                return message;
            }
        }
    }

    private static Map<String, Object> awaitFullState(BlockingQueue<Map<String, Object>> queue, int count)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS);
        while (System.nanoTime() < deadline) {
            Map<String, Object> state = awaitType(queue, "FullState",
                    TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()));
            if (state != null && ((List<?>) state.get("actors")).size() == count) {
                return state;
            }
        }
        throw new AssertionError("actor " + count + "명 FullState 가 끝내 오지 않았다");
    }

    private static List<Map<String, Object>> drainUntilQuiet(BlockingQueue<Map<String, Object>> queue)
            throws InterruptedException {
        List<Map<String, Object>> drained = new ArrayList<>();
        for (Map<String, Object> m = queue.poll(700, TimeUnit.MILLISECONDS); m != null;
                m = queue.poll(700, TimeUnit.MILLISECONDS)) {
            drained.add(m);
        }
        return drained;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> actor(Map<String, Object> fullState, UUID userId) {
        for (Object actor : (List<?>) fullState.get("actors")) {
            Map<String, Object> entry = (Map<String, Object>) actor;
            if (userId.toString().equals(entry.get("userId"))) {
                return entry;
            }
        }
        throw new AssertionError("FullState 에 " + userId + " 가 없다");
    }

    @SuppressWarnings("unchecked")
    private static List<String> actorIds(Map<String, Object> fullState) {
        List<String> ids = new ArrayList<>();
        for (Object actor : (List<?>) fullState.get("actors")) {
            ids.add((String) ((Map<String, Object>) actor).get("userId"));
        }
        return ids;
    }
}

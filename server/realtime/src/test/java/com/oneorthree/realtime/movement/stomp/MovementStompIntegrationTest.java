package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.focus.IslandFocusSessions;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
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
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
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
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 이동 STOMP 채널이 끝에서 끝까지 이어졌는지 (GROMO-2247) — 실 소켓·실 Redis·실 DB·실 틱(50ms).
 *
 * <p>멤버십은 운영 기본값(현재 인가 OFF)대로 Redis 캐시 + {@link GroupClient} 경로를 탄다 — 상류만 목이다. 목 구성은
 * {@code IslandRealtimeIntegrationTest} 와 똑같이 둬 Spring 테스트 컨텍스트를 나눠 쓴다.
 *
 * <p>구독에는 RECEIPT 가 없지만 이동 채널은 <b>첫 FullState 가 곧 구독 완료 신호</b>라 재시도 루프가 필요 없다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class MovementStompIntegrationTest {

    private static final long TIMEOUT_MS = 15_000;
    private static final double SPAWN_X = 38.5;
    private static final double SPAWN_Y = 45.5;
    /** 회관 입구 셀(67,27)의 중심 — 번들 nav.json {@code entrances.hall}. */
    private static final double HALL_X = 67.5;
    private static final double HALL_Y = 27.5;

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Value("${realtime.internal.data-service-token}")
    private String dataToken;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private IslandFocusSessions focusSessions;

    /** 멤버십 상류 — 섬 소속은 이 스텁 하나로 정한다(Redis 캐시는 첫 조회 결과를 담는다). */
    @MockitoBean
    private GroupClient groupClient;

    @MockitoBean
    private BlockClient blockClient;

    private WebSocketStompClient stompClient;
    private UUID island;
    private final Map<UUID, String> bearers = new HashMap<>();
    private final List<StompSession> opened = new ArrayList<>();

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));
    }

    @AfterEach
    void tearDown() {
        for (StompSession session : opened) {
            if (session.isConnected()) {
                session.disconnect();
            }
        }
        stompClient.stop();
    }

    @Test
    @DisplayName("① 구독 직후 첫 메시지는 FullState(스폰 위치·IDLE) ② 다른 주민이 구독하면 기존 구독자가 2명 FullState 를 받는다")
    void firstMessageIsFullStateAndJoinIsBroadcast() throws Exception {
        UUID a = member();
        UUID b = member();
        BlockingQueue<Map<String, Object>> aMoves = movement(connect(a));

        Map<String, Object> first = aMoves.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        assertThat(first).as("구독 직후 무언가 와야 한다").isNotNull();
        assertThat(first.get("type")).as("첫 메시지는 FullState").isEqualTo("FullState");
        assertThat(first.get("navRevision")).isEqualTo(1);
        assertThat(first.get("tickMs")).isEqualTo(50);
        Map<String, Object> me = actor(first, a);
        assertThat(me.get("state")).isEqualTo("IDLE");
        assertThat(me.get("x")).isEqualTo(SPAWN_X);
        assertThat(me.get("y")).isEqualTo(SPAWN_Y);
        assertThat(me.get("pathId")).isEqualTo(0);
        assertThat(me.get("lastCommandSeq")).isEqualTo(0);
        assertThat((List<?>) me.get("waypoints")).isEmpty();

        BlockingQueue<Map<String, Object>> bMoves = movement(connect(b));
        Map<String, Object> bFirst = bMoves.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        assertThat(bFirst).isNotNull();
        assertThat(bFirst.get("type")).isEqualTo("FullState");
        assertThat(actorIds(awaitFullState(aMoves, 2))).containsExactlyInAnyOrder(a.toString(), b.toString());
    }

    @Test
    @DisplayName("③ intent 가 받아들여지면 두 구독자에게 PathAccepted, 스냅샷 구독자에게 Snapshot(틱 증가·MOVING), 도착하면 Arrived 1회")
    void acceptedIntentIsBroadcastSnapshottedAndArrivesOnce() throws Exception {
        UUID a = member();
        UUID b = member();
        StompSession sa = connect(a);
        BlockingQueue<Map<String, Object>> aMoves = movement(sa);
        awaitFullState(aMoves, 1);
        StompSession sb = connect(b);
        BlockingQueue<Map<String, Object>> bMoves = movement(sb);
        BlockingQueue<Map<String, Object>> bSnapshots = snapshots(sb);
        awaitFullState(bMoves, 2);
        awaitFullState(aMoves, 2);
        drainUntilQuiet(aMoves);
        drainUntilQuiet(bMoves);

        sa.send(intentDestination(), intent(1, HALL_X, HALL_Y));

        Map<String, Object> accepted = awaitType(aMoves, "PathAccepted", TIMEOUT_MS);
        assertThat(accepted).as("요청자가 PathAccepted 를 받아야 한다").isNotNull();
        assertThat(accepted.get("userId")).isEqualTo(a.toString());
        assertThat(accepted.get("commandSeq")).isEqualTo(1);
        assertThat(accepted.get("navRevision")).isEqualTo(1);
        assertThat((List<?>) accepted.get("waypoints")).as("출발 제외 셀 중심 열").isNotEmpty();
        assertThat(accepted.get("goal")).isEqualTo(Map.of("x", HALL_X, "y", HALL_Y));
        Map<String, Object> seenByB = awaitType(bMoves, "PathAccepted", TIMEOUT_MS);
        assertThat(seenByB).as("방 전원에게 간다").isNotNull();
        assertThat(seenByB.get("pathId")).isEqualTo(accepted.get("pathId"));

        Map<String, Object> arrived = awaitType(aMoves, "Arrived", TIMEOUT_MS);
        assertThat(arrived).as("수십 틱 뒤 도착해야 한다").isNotNull();
        assertThat(arrived.get("pathId")).isEqualTo(accepted.get("pathId"));
        assertThat(arrived.get("position")).isEqualTo(Map.of("x", HALL_X, "y", HALL_Y));
        assertThat(awaitType(bMoves, "Arrived", TIMEOUT_MS)).isNotNull();
        assertThat(awaitType(aMoves, "Arrived", 1_000)).as("경로당 Arrived 는 1회").isNull();

        List<Map<String, Object>> received = drainUntilQuiet(bSnapshots);
        assertThat(received).as("걷는 동안 Snapshot 이 와야 한다").isNotEmpty();
        long previousTick = -1;
        boolean sawMoving = false;
        for (Map<String, Object> snapshot : received) {
            assertThat(snapshot.get("type")).isEqualTo("Snapshot");
            long serverTick = ((Number) snapshot.get("serverTick")).longValue();
            assertThat(serverTick).as("틱당 최대 1개 — 20Hz 이하").isGreaterThan(previousTick);
            previousTick = serverTick;
            Map<String, Object> walker = entity(snapshot, a);
            sawMoving |= "MOVING".equals(walker.get("state")) && accepted.get("pathId").equals(walker.get("pathId"));
        }
        assertThat(sawMoving).as("Snapshot 에 걷는 A 가 MOVING 으로 실린다").isTrue();
        assertThat(entity(received.get(received.size() - 1), a).get("state"))
                .as("멈춘 뒤 1회 — 마지막 Snapshot 은 정지 상태다(N15)").isEqualTo("IDLE");
    }

    @Test
    @DisplayName("④ 범위 밖 intent 는 요청자에게만 MoveRejected(OUT_OF_RANGE) — 다른 구독자는 아무것도 받지 않는다")
    void outOfRangeIntentIsRejectedToTheSenderOnly() throws Exception {
        UUID a = member();
        UUID b = member();
        StompSession sa = connect(a);
        BlockingQueue<Map<String, Object>> aMoves = movement(sa);
        awaitFullState(aMoves, 1);
        BlockingQueue<Map<String, Object>> bMoves = movement(connect(b));
        awaitFullState(bMoves, 2);
        drainUntilQuiet(aMoves);
        drainUntilQuiet(bMoves);

        sa.send(intentDestination(), intent(1, 1000, HALL_Y));

        Map<String, Object> rejected = awaitType(aMoves, "MoveRejected", TIMEOUT_MS);
        assertThat(rejected).isNotNull();
        assertThat(rejected.get("reason")).isEqualTo("OUT_OF_RANGE");
        assertThat(rejected.get("userId")).isEqualTo(a.toString());
        assertThat(rejected.get("commandSeq")).isEqualTo(1);
        assertThat(rejected.get("position")).isEqualTo(Map.of("x", SPAWN_X, "y", SPAWN_Y));
        assertThat(bMoves.poll(500, TimeUnit.MILLISECONDS)).as("거절은 요청자 세션에만(N4)").isNull();
    }

    @Test
    @DisplayName("⑤ 비멤버의 구독은 ERROR(NOT_A_MEMBER)·소켓 종료로 거절되고 방의 다른 구독자에겐 아무것도 가지 않는다")
    void nonMemberSubscriptionIsRefusedWithoutTouchingTheRoom() throws Exception {
        UUID a = member();
        UUID b = member();
        BlockingQueue<Map<String, Object>> aMoves = movement(connect(a));
        awaitFullState(aMoves, 1);
        BlockingQueue<Map<String, Object>> bMoves = movement(connect(b));
        awaitFullState(bMoves, 2);
        drainUntilQuiet(aMoves);
        drainUntilQuiet(bMoves);

        UUID outsider = UUID.randomUUID();
        given(groupClient.fetchMyGroupIds(bearerOf(outsider))).willReturn(GroupClient.Membership.of(Set.of()));
        RecordingHandler handler = new RecordingHandler();
        StompSession sc = connect(outsider, handler);
        sc.subscribe("/topic/islands/" + island + "/movement", new DiscardingFrameHandler());

        assertThat(handler.awaitError()).isEqualTo(ChatErrorCode.NOT_A_MEMBER.name());
        awaitDisconnected(sc);
        assertThat(aMoves.poll(1, TimeUnit.SECONDS)).as("비멤버는 방에 들어오지 않는다").isNull();
        assertThat(bMoves.poll(500, TimeUnit.MILLISECONDS)).isNull();
    }

    @Test
    @DisplayName("⑥ movement 를 구독하지 않은 세션의 intent 는 ERROR(NOT_A_MEMBER)·소켓 종료로 거절된다")
    void intentWithoutSubscriptionIsRefused() throws Exception {
        UUID d = member();
        RecordingHandler handler = new RecordingHandler();
        StompSession sd = connect(d, handler);

        sd.send(intentDestination(), intent(1, HALL_X, HALL_Y));

        assertThat(handler.awaitError()).isEqualTo(ChatErrorCode.NOT_A_MEMBER.name());
        awaitDisconnected(sd);
    }

    @Test
    @DisplayName("⑦ 한 주민의 연결이 끊기면 남은 주민이 그 주민이 빠진 FullState 를 받는다")
    void disconnectBroadcastsFullStateWithoutTheLeaver() throws Exception {
        UUID a = member();
        UUID b = member();
        StompSession sa = connect(a);
        BlockingQueue<Map<String, Object>> aMoves = movement(sa);
        awaitFullState(aMoves, 1);
        BlockingQueue<Map<String, Object>> bMoves = movement(connect(b));
        awaitFullState(bMoves, 2);
        drainUntilQuiet(bMoves);

        sa.disconnect();

        assertThat(actorIds(awaitFullState(bMoves, 1))).containsExactly(b.toString());
    }

    @Test
    @DisplayName("⑧ 필드가 빠진 intent 는 개인 큐로 INVALID_REQUEST 를 받고 소켓이 유지된다 — 그 뒤 정상 intent 는 통한다")
    void malformedIntentGoesToThePersonalQueueAndKeepsTheSocket() throws Exception {
        UUID a = member();
        StompSession sa = connect(a);
        BlockingQueue<SendFailureResponse> errors = personalErrors(sa);
        BlockingQueue<Map<String, Object>> aMoves = movement(sa);
        awaitFullState(aMoves, 1);

        sa.send(intentDestination(), Map.of("commandSeq", 1, "navRevision", 1, "goalX", HALL_X));

        SendFailureResponse failure = errors.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(CommonErrorCode.INVALID_REQUEST.name());
        assertThat(sa.isConnected()).as("필드 하나 빠졌다고 세션이 죽으면 안 된다").isTrue();

        sa.send(intentDestination(), intent(1, HALL_X, HALL_Y));
        assertThat(awaitType(aMoves, "PathAccepted", TIMEOUT_MS)).as("같은 세션의 다음 intent 는 정상 처리된다")
                .isNotNull();
    }

    @Test
    @DisplayName("⑨ island.members.updated 로 탈락한 주민은 방에서 나가고 남은 주민이 FullState 를 받는다 — 탈락자에겐 더 보내지 않고, "
            + "같은 id 로 다시 구독하면 관문이 다시 판정해 ERROR·종료")
    void membershipRemovalEvictsTheResident() throws Exception {
        UUID a = member();
        UUID b = member();
        BlockingQueue<Map<String, Object>> aMoves = movement(connect(a));
        awaitFullState(aMoves, 1);
        RecordingHandler bHandler = new RecordingHandler();
        StompSession sb = connect(b, bHandler);
        BlockingQueue<Map<String, Object>> bMoves = collect(sb, subscription(movementDestination(), "b-move"));
        snapshots(sb); // 짝 토픽 — 강퇴 뒤 남은 이 기록이 재구독의 판정을 건너뛰게 하던 자리다
        awaitFullState(bMoves, 2);
        awaitFullState(aMoves, 2);
        drainUntilQuiet(aMoves);
        drainUntilQuiet(bMoves);

        // 강퇴 — Data 정본이 바뀌었다. 사건이 그 사람의 캐시를 지우므로 재검사는 이 답을 본다.
        given(groupClient.fetchMyGroupIds(bearerOf(b))).willReturn(GroupClient.Membership.of(Set.of()));
        postEvent(membersUpdated(b));

        assertThat(actorIds(awaitFullState(aMoves, 1))).containsExactly(a.toString());
        assertThat(bMoves.poll(1, TimeUnit.SECONDS)).as("탈락자에겐 퇴장 FullState 도 가지 않는다(N7)").isNull();

        sb.subscribe(subscription(movementDestination(), "b-move"), new DiscardingFrameHandler());
        assertThat(bHandler.awaitError()).as("같은 id 재구독도 관문이 다시 판정한다").isEqualTo(ChatErrorCode.NOT_A_MEMBER.name());
        awaitDisconnected(sb);
        assertThat(aMoves.poll(1, TimeUnit.SECONDS)).as("방에 다시 들어오지 않는다").isNull();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** 이 섬의 멤버 — 첫 SUBSCRIBE 의 멤버십 조회가 이 스텁을 본다. */
    private UUID member() {
        UUID userId = UUID.randomUUID();
        given(groupClient.fetchMyGroupIds(bearerOf(userId))).willReturn(GroupClient.Membership.of(Set.of(island)));
        return userId;
    }

    private StompSession connect(UUID userId) throws Exception {
        return connect(userId, new StompSessionHandlerAdapter() { });
    }

    private StompSession connect(UUID userId, StompSessionHandlerAdapter handler) throws Exception {
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", bearerOf(userId));
        StompSession session = stompClient.connectAsync("ws://localhost:" + port + "/ws/realtime",
                new WebSocketHttpHeaders(), connectHeaders, handler).get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        opened.add(session);
        return session;
    }

    private BlockingQueue<Map<String, Object>> movement(StompSession session) {
        return collect(session, subscription(movementDestination(), null));
    }

    private BlockingQueue<Map<String, Object>> snapshots(StompSession session) {
        return collect(session, subscription("/topic/islands/" + island + "/movement/snapshot", null));
    }

    private String movementDestination() {
        return "/topic/islands/" + island + "/movement";
    }

    /** {@code id} 가 null 이면 클라이언트가 매긴다. */
    private static StompHeaders subscription(String destination, String id) {
        StompHeaders headers = new StompHeaders();
        headers.setDestination(destination);
        if (id != null) {
            headers.setId(id);
        }
        return headers;
    }

    private static BlockingQueue<Map<String, Object>> collect(StompSession session, StompHeaders subscription) {
        BlockingQueue<Map<String, Object>> queue = new LinkedBlockingQueue<>();
        session.subscribe(subscription, new StompFrameHandler() {
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

    private static BlockingQueue<SendFailureResponse> personalErrors(StompSession session) {
        BlockingQueue<SendFailureResponse> queue = new LinkedBlockingQueue<>();
        session.subscribe("/user/queue/errors", new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return SendFailureResponse.class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                queue.add((SendFailureResponse) payload);
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

    /** 그 type 이 올 때까지 다른 메시지는 건너뛴다. 시간 안에 안 오면 null. */
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

    /** actor 가 정확히 {@code count} 명인 FullState 가 올 때까지 기다린다(남의 입장·퇴장 전원 FullState 와 자기 한정 FullState 가 섞여 온다). */
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

    /** 뒤늦게 오는 것들이 멎을 때까지 비운다 — 「이 뒤로는 안 온다」를 단언하기 전에 필요하다. */
    private static List<Map<String, Object>> drainUntilQuiet(BlockingQueue<Map<String, Object>> queue)
            throws InterruptedException {
        List<Map<String, Object>> drained = new ArrayList<>();
        for (Map<String, Object> m = queue.poll(500, TimeUnit.MILLISECONDS); m != null;
                m = queue.poll(500, TimeUnit.MILLISECONDS)) {
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
    private static Map<String, Object> entity(Map<String, Object> snapshot, UUID userId) {
        for (Object entity : (List<?>) snapshot.get("entities")) {
            Map<String, Object> entry = (Map<String, Object>) entity;
            if (userId.toString().equals(entry.get("userId"))) {
                return entry;
            }
        }
        throw new AssertionError("Snapshot 에 " + userId + " 가 없다");
    }

    @SuppressWarnings("unchecked")
    private static List<String> actorIds(Map<String, Object> fullState) {
        List<String> ids = new ArrayList<>();
        for (Object actor : (List<?>) fullState.get("actors")) {
            ids.add((String) ((Map<String, Object>) actor).get("userId"));
        }
        return ids;
    }

    private static void awaitDisconnected(StompSession session) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS);
        while (session.isConnected() && System.nanoTime() < deadline) {
            Thread.sleep(100);
        }
        assertThat(session.isConnected()).as("관문 거절은 ERROR 프레임 + 연결 종료다").isFalse();
    }

    private void postEvent(String body) throws Exception {
        mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken)).andExpect(status().isOk());
    }

    /** Data {@code IslandMembershipEvents#changed} 의 강퇴 봉투 — {@code InboundEventServiceTest} 와 같은 모양. */
    private String membersUpdated(UUID removed) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"island.members.updated\",\"occurredAt\":\"2026-10-09T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + UUID.randomUUID() + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":5,\"params\":{\"changeKind\":\"MEMBER_REMOVED\",\"islandId\":\"" + island + "\","
                + "\"memberUserId\":\"" + removed + "\"}}";
    }

    /** userId 당 한 번만 만든다 — 매번 만들면 exp 가 달라져 문자열이 바뀌고 상류 스텁이 어긋난다. */
    private String bearerOf(UUID userId) {
        return bearers.computeIfAbsent(userId, id -> "Bearer " + Jwts.builder()
                .subject(id.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plus(Duration.ofHours(1))))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact());
    }

    /** ERROR 프레임의 {@code message} 헤더(기계용 코드)를 모은다 — {@code ChatWebSocketIntegrationTest} 와 같은 방식. */
    private static final class RecordingHandler extends StompSessionHandlerAdapter {

        private final BlockingQueue<String> errors = new LinkedBlockingQueue<>();

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
            return errors.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        }
    }

    /** 도착하면 안 되는 프레임을 위한 자리. */
    private static final class DiscardingFrameHandler implements StompFrameHandler {

        @Override
        public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
            return byte[].class;
        }

        @Override
        public void handleFrame(@NonNull StompHeaders headers, Object payload) {
            // 버린다.
        }
    }
}

package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
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
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
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
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 먼바다 방이 <b>끝에서 끝까지</b> 이어졌는지 (GROMO-2300, 계약 §5·§7) — 실 소켓·실 Redis·실 DB.
 *
 * <p>스텁은 Data 로 나가는 네트워크 경계 셋뿐이다({@link SeaStateClient}·{@link FriendsClient}·{@link BlockClient}).
 * 구독 등록에는 RECEIPT 가 없어서, 방 토픽 등록은 «그 사람의 한마디 사건을 도착할 때까지 다시 보내기»로 관측한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class SeaRoomIntegrationTest {

    private static final long TIMEOUT_SECONDS = 15;

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Value("${realtime.internal.data-service-token}")
    private String dataToken;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private SeaStateClient seaState;

    @MockitoBean
    private FriendsClient friends;

    /** 목의 기본값(빈 집합) = 차단 없음. 테스트가 사람별로 덮는다. */
    @MockitoBean
    private BlockClient blockClient;

    private WebSocketStompClient stompClient;
    private final UUID destination = UUID.randomUUID();
    private final Map<UUID, String> bearers = new HashMap<>();

    @BeforeEach
    void setUp() {
        // 다른 테스트가 남긴 빈자리 후보를 지운다 — 배정 우선순위 단언이 그 방들에 흔들리지 않게.
        redis.delete(RedisKeys.SEA_ROOMS_OPEN);
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));
    }

    @AfterEach
    void tearDown() {
        stompClient.stop();
    }

    @Test
    @DisplayName("enter → 그 세션에 assigned{roomId, members} 가 오고 Redis 키가 생긴다")
    void enterAssignsAndCreatesKeys() throws Exception {
        UUID alice = sailor();
        Client client = connect(alice);

        Map<String, Object> assigned = client.enter();

        assertThat(assigned.get("type")).isEqualTo("sea.room.assigned");
        assertThat(payload(assigned)).as("assigned 는 roomId 만 — 구성원은 구독 뒤 sync 로").containsOnlyKeys("roomId");
        UUID room = roomOf(assigned);
        Map<String, Object> snapshot = client.sync();
        assertThat(snapshot.get("type")).isEqualTo("sea.room.snapshot");
        assertThat(memberIds(payload(snapshot))).containsExactly(alice.toString());
        @SuppressWarnings("unchecked")
        Map<String, Object> member = ((List<Map<String, Object>>) payload(snapshot).get("members")).get(0);
        assertThat(member.get("state")).isEqualTo("focusing");
        @SuppressWarnings("unchecked")
        Map<String, Object> session = (Map<String, Object>) member.get("session");
        assertThat(session.get("destinationIslandId")).isEqualTo(destination.toString());
        assertThat(session.get("sailingMinutes")).isEqualTo(30);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "roomId")).isEqualTo(room.toString());
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), alice.toString())).isTrue();
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isTrue();
    }

    @Test
    @DisplayName("둘째 입장은 첫째 방으로 — 첫째의 방 토픽에 sea.member.joined 가 온다")
    void secondEnterJoinsTheFirstRoom() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        BlockingQueue<Map<String, Object>> heard = a.watch(room, alice);

        Client b = connect(bob);
        Map<String, Object> assigned = b.enter();

        assertThat(roomOf(assigned)).isEqualTo(room);
        assertThat(memberIds(payload(b.sync()))).containsExactlyInAnyOrder(alice.toString(), bob.toString());
        Map<String, Object> joined = await(heard, frame -> "sea.member.joined".equals(frame.get("type")));
        assertThat(memberOf(joined).get("userId")).isEqualTo(bob.toString());
    }

    @Test
    @DisplayName("10명이 찬 방에는 11번째를 넣지 않고 그 방을 open 에서 뺀다")
    void eleventhGoesToAnotherRoom() throws Exception {
        UUID full = UUID.randomUUID();
        for (int i = 0; i < SeaRooms.SEA_ROOM_CAPACITY; i++) {
            redis.opsForSet().add(RedisKeys.seaRoomMembers(full), UUID.randomUUID().toString());
        }
        redis.opsForSet().add(RedisKeys.SEA_ROOMS_OPEN, full.toString());

        UUID eleventh = sailor();
        UUID room = roomOf(connect(eleventh).enter());

        assertThat(room).isNotEqualTo(full);
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, full.toString())).isFalse();
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(full))).isEqualTo(10L);
    }

    @Test
    @DisplayName("차단 쌍은 어느 방향이든 다른 방 — 필터 스위치(기본 false)와 무관하다")
    void blockedPairsAreSeparatedInBothDirections() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        given(blockClient.fetchBlockedIds(alice)).willReturn(Set.of(bob)); // 먼저 온 쪽이 차단
        UUID aliceRoom = roomOf(connect(alice).enter());
        assertThat(roomOf(connect(bob).enter())).isNotEqualTo(aliceRoom);

        redis.delete(RedisKeys.SEA_ROOMS_OPEN);
        UUID carol = sailor();
        UUID dave = sailor();
        given(blockClient.fetchBlockedIds(dave)).willReturn(Set.of(carol)); // 나중에 온 쪽이 차단
        UUID carolRoom = roomOf(connect(carol).enter());
        assertThat(roomOf(connect(dave).enter())).isNotEqualTo(carolRoom);
    }

    @Test
    @DisplayName("친구 있는 방 > 같은 목적지로 항해 중인 방 > 큰 방")
    void friendsThenSameDestinationThenSize() throws Exception {
        UUID stranger = UUID.randomUUID();
        UUID friend = UUID.randomUUID();
        UUID sameDestinationRoom = preloadRoom(Map.of(stranger, destination));
        UUID friendRoom = preloadRoom(Map.of(friend, UUID.randomUUID()));
        UUID bigRoom = preloadRoom(Map.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID()));

        UUID me = sailor();
        given(friends.fetchFriendIds(me)).willReturn(Set.of(friend));
        assertThat(roomOf(connect(me).enter())).isEqualTo(friendRoom);

        assertThat(bigRoom).isNotNull();

        // 친구가 없으면 같은 목적지로 항해 중인 방이 더 큰 방을 이긴다.
        redis.delete(RedisKeys.SEA_ROOMS_OPEN);
        UUID sameDestination = preloadRoom(Map.of(UUID.randomUUID(), destination));
        preloadRoom(Map.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID()));
        UUID other = sailor();
        assertThat(roomOf(connect(other).enter())).isEqualTo(sameDestination);
        assertThat(sameDestinationRoom).isNotEqualTo(sameDestination);
    }

    @Test
    @DisplayName("Data sea.member.updated{ended} → 방 토픽 member.state=adrift, 해시 adriftSince, sea:adrift 색인")
    void dataEventIsRelayedToTheRoom() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        BlockingQueue<Map<String, Object>> heard = a.watch(room, alice);

        postSea(alice, "ended", null);

        Map<String, Object> updated = await(heard, frame -> "sea.member.updated".equals(frame.get("type"))
                && "adrift".equals(memberOf(frame).get("state")));
        assertThat(memberOf(updated).get("userId")).isEqualTo(alice.toString());
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "adriftSince")).isNotNull();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, alice.toString())).isNotNull();
    }

    @Test
    @DisplayName("바다 밖 사용자의 사건·불량 params 는 200 이고 키도 프레임도 만들지 않는다")
    void eventsOutsideTheSeaAreNoOps() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        BlockingQueue<Map<String, Object>> heard = a.watch(room, alice);
        UUID outsider = UUID.randomUUID();

        postSea(outsider, "remark", "안녕");
        postEvent(seaEvent(alice, "\"status\":\"teleported\""));
        postEvent(seaEvent(alice, "\"status\":\"sailing\",\"sessionId\":\"not-a-uuid\""));

        assertThat(redis.hasKey(RedisKeys.seaUser(outsider))).isFalse();
        assertThat(heard.poll(1, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("leave → 다른 구성원에게 left{left}, 키 삭제, 마지막이 나가면 방 DEL·open 에서 뺀다")
    void leaveNotifiesAndCleansUp() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client a = connect(alice);
        Client b = connect(bob);
        UUID room = roomOf(a.enter());
        b.enter();
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);

        a.session.send("/app/sea/leave", Map.of());

        Map<String, Object> left = await(heardByBob, frame -> "sea.member.left".equals(frame.get("type")));
        assertThat(payload(left)).containsEntry("userId", alice.toString()).containsEntry("reason", "left");
        assertThat(redis.hasKey(RedisKeys.seaUser(alice))).isFalse();

        b.session.send("/app/sea/leave", Map.of());
        awaitTrue(() -> !Boolean.TRUE.equals(redis.hasKey(RedisKeys.seaRoomMembers(room))));
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, room.toString())).isFalse();
    }

    @Test
    @DisplayName("두 기기 — 재입장은 같은 방·joined 없음, 첫 소켓 종료는 무사건, 마지막 종료에 left{disconnected}")
    void twoDevicesLeaveOnlyWhenTheLastSocketCloses() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client phone = connect(alice);
        Client b = connect(bob);
        UUID room = roomOf(phone.enter());
        b.enter();
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);

        Client tablet = connect(alice);
        assertThat(roomOf(tablet.enter())).as("재입장은 기존 방 재확인이다").isEqualTo(room);
        phone.session.disconnect();
        awaitTrue(() -> !phone.session.isConnected());
        // 표지 사건 — bob 의 한마디 갱신이 먼저 오면 그 앞에 joined·left 가 없었다는 뜻이다.
        postSea(bob, "remark", "표지");
        Map<String, Object> marker = heardByBob.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(marker).isNotNull();
        assertThat(marker.get("type")).as("재입장 joined·첫 종료 left 가 없어야 한다").isEqualTo("sea.member.updated");
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "roomId")).isEqualTo(room.toString());

        tablet.session.disconnect();
        Map<String, Object> left = await(heardByBob, frame -> "sea.member.left".equals(frame.get("type")));
        assertThat(payload(left)).containsEntry("userId", alice.toString()).containsEntry("reason", "disconnected");
    }

    @Test
    @DisplayName("방 토픽 UNSUBSCRIBE 는 퇴장이다 — left{left}")
    void unsubscribeLeaves() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client a = connect(alice);
        Client b = connect(bob);
        UUID room = roomOf(a.enter());
        b.enter();
        a.watch(room, alice);
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);

        a.subscription.unsubscribe();

        Map<String, Object> left = await(heardByBob, frame -> "sea.member.left".equals(frame.get("type")));
        assertThat(payload(left)).containsEntry("userId", alice.toString()).containsEntry("reason", "left");
    }

    @Test
    @DisplayName("소속이 아닌 방 SUBSCRIBE → ERROR NOT_IN_SEA_ROOM + 소켓 종료")
    void subscribingToAForeignRoomIsRejected() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        a.session.subscribe("/topic/sea/rooms/" + UUID.randomUUID(), new QueueHandler(new LinkedBlockingQueue<>()));

        assertThat(a.errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isEqualTo(ChatErrorCode.NOT_IN_SEA_ROOM.name());
        awaitTrue(() -> !a.session.isConnected());
    }

    @Test
    @DisplayName("Redis 에서 빠진 사람(다른 인스턴스의 정리)은 구독이 남아 있어도 다음 방 사건을 받지 않는다")
    void removedFromRedisReceivesNothing() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client a = connect(alice);
        Client b = connect(bob);
        UUID room = roomOf(a.enter());
        b.enter();
        BlockingQueue<Map<String, Object>> heardByAlice = a.watch(room, alice);
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);

        redis.delete(RedisKeys.seaUser(bob)); // 다른 인스턴스가 LEAVE 했다고 치자 — 이 JVM 의 구독은 그대로다
        redis.opsForSet().remove(RedisKeys.seaRoomMembers(room), bob.toString());
        postSea(alice, "remark", "표지");

        await(heardByAlice, frame -> "sea.member.updated".equals(frame.get("type")));
        assertThat(heardByBob.poll(1, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("enter 연타 → ERROR SEA_ENTER_TOO_FREQUENT + 소켓 종료")
    void enterBurstIsRejected() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        redis.delete(RedisKeys.seaEnterAttempt(alice));

        a.session.send("/app/sea/enter", Map.of());
        a.session.send("/app/sea/enter", Map.of());

        assertThat(a.errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .isEqualTo(ChatErrorCode.SEA_ENTER_TOO_FREQUENT.name());
        awaitTrue(() -> !a.session.isConnected());
    }

    @Test
    @DisplayName("바다 상태 조회 실패 → /user/queue/errors 로 UPSTREAM_UNAVAILABLE, 키 없음, 연결 유지")
    void seaStateFailureIsReportedPrivately() throws Exception {
        UUID alice = UUID.randomUUID();
        given(seaState.fetch(alice)).willThrow(new UpstreamUnavailableException());
        Client a = connect(alice);
        BlockingQueue<SendFailureResponse> failures = new LinkedBlockingQueue<>();
        a.session.subscribe("/user/queue/errors", new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
                return SendFailureResponse.class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                failures.add((SendFailureResponse) payload);
            }
        });

        SendFailureResponse failure = null;
        for (int attempt = 0; attempt < 20 && failure == null; attempt++) {
            redis.delete(RedisKeys.seaEnterAttempt(alice));
            a.session.send("/app/sea/enter", Map.of());
            failure = failures.poll(500, TimeUnit.MILLISECONDS);
        }

        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(CommonErrorCode.UPSTREAM_UNAVAILABLE.name());
        assertThat(redis.hasKey(RedisKeys.seaUser(alice))).isFalse();
        assertThat(a.session.isConnected()).isTrue();
    }

    @Test
    @DisplayName("[P1] 차단 쌍이 같은 후보 방에 동시에 들어와도 갈라진다 — 차단 검사와 JOIN 사이 경합(-2)")
    void concurrentBlockedEntrantsAreSeparated() throws Exception {
        for (int round = 0; round < 5; round++) {
            redis.delete(RedisKeys.SEA_ROOMS_OPEN);
            UUID room = preloadRoom(Map.of(UUID.randomUUID(), destination));
            UUID alice = sailor();
            UUID bob = sailor();
            given(blockClient.fetchBlockedIds(alice)).willReturn(Set.of(bob));
            Client a = connect(alice);
            Client b = connect(bob);
            java.util.concurrent.CompletableFuture<Map<String, Object>> first =
                    java.util.concurrent.CompletableFuture.supplyAsync(() -> enterUnchecked(a));
            java.util.concurrent.CompletableFuture<Map<String, Object>> second =
                    java.util.concurrent.CompletableFuture.supplyAsync(() -> enterUnchecked(b));
            UUID aliceRoom = roomOf(first.get(TIMEOUT_SECONDS * 2, TimeUnit.SECONDS));
            UUID bobRoom = roomOf(second.get(TIMEOUT_SECONDS * 2, TimeUnit.SECONDS));
            assertThat(aliceRoom).as("round %d", round).isNotEqualTo(bobRoom);
            assertThat(List.of(aliceRoom, bobRoom)).contains(room);
        }
    }

    @Test
    @DisplayName("[P2] 해시만 사라진 사람이 다시 enter 하면 해시가 복구되고 방 토픽 구독이 통과한다")
    void reEnterRestoresAMissingHash() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        redis.delete(RedisKeys.seaUser(alice));

        assertThat(roomOf(a.enter())).isEqualTo(room);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "roomId")).isEqualTo(room.toString());
        assertThat(redis.opsForSet().size(RedisKeys.seaRoomMembers(room))).isEqualTo(1L);
        a.watch(room, alice); // 구독 관문 통과 + 사건 수신
        assertThat(a.session.isConnected()).isTrue();
    }

    @Test
    @DisplayName("[P2] sync 는 그 세션에만 스냅샷을 돌려주고, 방이 없으면 NOT_IN_SEA_ROOM 을 개인 오류 큐로")
    void syncAnswersOnlyThatSession() throws Exception {
        UUID alice = sailor();
        Client phone = connect(alice);
        UUID room = roomOf(phone.enter());
        Client tablet = connect(alice);
        tablet.subscribeQueue();

        Map<String, Object> snapshot = phone.sync();
        assertThat(snapshot.get("roomId")).isEqualTo(room.toString());
        assertThat(tablet.assignments.poll(1, TimeUnit.SECONDS)).as("다른 기기에는 가지 않는다").isNull();

        Client outsider = connect(UUID.randomUUID());
        BlockingQueue<SendFailureResponse> failures = outsider.subscribeErrors();
        SendFailureResponse failure = null;
        for (int attempt = 0; attempt < 20 && failure == null; attempt++) {
            outsider.session.send("/app/sea/sync", Map.of());
            failure = failures.poll(500, TimeUnit.MILLISECONDS);
        }
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.NOT_IN_SEA_ROOM.name());
        assertThat(outsider.session.isConnected()).isTrue();
    }

    @Test
    @DisplayName("[P2] 첫 조회와 JOIN 사이에 항해가 끝났으면(재조회 session=null) 입장 뒤 상태가 adrift 다")
    void endedBetweenFetchAndJoinIsApplied() throws Exception {
        UUID alice = UUID.randomUUID();
        Instant now = Instant.now();
        given(seaState.fetch(alice)).willReturn(
                new SeaStateClient.SeaState(null, null,
                        new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now)),
                new SeaStateClient.SeaState(null, null, null));
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());

        connect(alice).enter();

        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "state")).isEqualTo("adrift");
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "adriftSince")).isNotNull();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, alice.toString())).isNotNull();
    }

    @Test
    @DisplayName("[P2] activeSeconds 가 long 최댓값인 sailing 사건 → 200 이고 상태는 그대로다")
    void absurdActiveSecondsIsIgnored() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        a.enter();
        Object sessionBefore = redis.opsForHash().get(RedisKeys.seaUser(alice), "sessionId");
        Object startedBefore = redis.opsForHash().get(RedisKeys.seaUser(alice), "startedAt");

        postEvent(seaEvent(alice, "\"status\":\"sailing\",\"sessionId\":\"" + UUID.randomUUID() + "\","
                + "\"activeSeconds\":9223372036854775807,\"serverNow\":\"2026-10-17T00:00:00Z\""));

        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "sessionId")).isEqualTo(sessionBefore);
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "startedAt")).isEqualTo(startedBefore);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static Map<String, Object> enterUnchecked(Client client) {
        try {
            return client.enter();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** 이 테스트 목적지로 항해 중인 새 사용자. */
    private UUID sailor() {
        UUID user = UUID.randomUUID();
        Instant now = Instant.now();
        given(seaState.fetch(user)).willReturn(new SeaStateClient.SeaState(null, null,
                new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now)));
        given(friends.fetchFriendIds(user)).willReturn(Set.of());
        return user;
    }

    /** 사용자별 목적지로 항해 중인 구성원들로 방 하나를 Redis 에 직접 만든다. */
    private UUID preloadRoom(Map<UUID, UUID> destinationByUser) {
        UUID room = UUID.randomUUID();
        destinationByUser.forEach((user, dest) -> {
            redis.opsForSet().add(RedisKeys.seaRoomMembers(room), user.toString());
            redis.opsForHash().putAll(RedisKeys.seaUser(user), Map.of("roomId", room.toString(), "state", "focusing",
                    "destinationIslandId", dest.toString()));
        });
        redis.opsForSet().add(RedisKeys.SEA_ROOMS_OPEN, room.toString());
        return room;
    }

    private void postSea(UUID user, String status, String remark) throws Exception {
        postEvent(seaEvent(user, "\"status\":\"" + status + "\",\"sessionId\":null,\"destinationIslandId\":null,"
                + "\"sailingMinutes\":null,\"activeSeconds\":0,\"arrived\":null,"
                + "\"remark\":" + (remark == null ? "null" : "\"" + remark + "\"")
                + ",\"serverNow\":\"2026-10-17T00:00:00Z\""));
    }

    /** Data outbox 정본 10필드 — 계약 §4 의 모양. */
    private static String seaEvent(UUID user, String params) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,\"type\":\"sea.member.updated\","
                + "\"occurredAt\":\"2026-10-17T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":1,\"params\":{" + params + "}}";
    }

    private void postEvent(String body) throws Exception {
        mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken)).andExpect(status().isOk());
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

    private static void awaitTrue(java.util.function.BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                throw new AssertionError("조건이 끝내 참이 되지 않았다");
            }
            Thread.sleep(50);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> payload(Map<String, Object> frame) {
        return (Map<String, Object>) frame.get("payload");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> memberOf(Map<String, Object> frame) {
        return (Map<String, Object>) payload(frame).get("member");
    }

    @SuppressWarnings("unchecked")
    private static List<String> memberIds(Map<String, Object> payload) {
        return ((List<Map<String, Object>>) payload.get("members")).stream()
                .map(member -> (String) member.get("userId")).toList();
    }

    private static UUID roomOf(Map<String, Object> assigned) {
        return UUID.fromString((String) assigned.get("roomId"));
    }

    private Client connect(UUID userId) throws Exception {
        String bearer = bearers.computeIfAbsent(userId, id -> "Bearer " + Jwts.builder()
                .subject(id.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact());
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        Client client = new Client(userId);
        client.session = stompClient.connectAsync("ws://localhost:" + port + "/ws/realtime",
                new WebSocketHttpHeaders(), headers, client.recorder).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        return client;
    }

    /** 한 소켓 — 배정 큐·ERROR 프레임을 모은다. */
    private final class Client {

        private final UUID userId;
        private final BlockingQueue<String> errors = new LinkedBlockingQueue<>();
        private final BlockingQueue<Map<String, Object>> assignments = new LinkedBlockingQueue<>();
        private StompSession session;
        private StompSession.Subscription subscription;
        private boolean queueSubscribed;

        private final StompSessionHandlerAdapter recorder = new StompSessionHandlerAdapter() {
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
        };

        Client(UUID userId) {
            this.userId = userId;
        }

        void subscribeQueue() {
            if (!queueSubscribed) {
                session.subscribe("/user/queue/sea", new QueueHandler(assignments));
                queueSubscribed = true;
            }
        }

        BlockingQueue<SendFailureResponse> subscribeErrors() {
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

        /** {@code SEND /app/sea/sync} — 스냅샷이 올 때까지 다시 보낸다. */
        Map<String, Object> sync() throws InterruptedException {
            subscribeQueue();
            for (int attempt = 0; attempt < 30; attempt++) {
                session.send("/app/sea/sync", Map.of());
                Map<String, Object> frame = assignments.poll(500, TimeUnit.MILLISECONDS);
                if (frame != null && "sea.room.snapshot".equals(frame.get("type"))) {
                    frame.put("roomId", payload(frame).get("roomId"));
                    assignments.clear();
                    return frame;
                }
            }
            throw new AssertionError("스냅샷이 끝내 오지 않았다 — errors=" + errors);
        }

        /** {@code SUB /user/queue/sea} → {@code SEND /app/sea/enter} — assigned 가 올 때까지 다시 보낸다(창은 비운다). */
        Map<String, Object> enter() throws InterruptedException {
            subscribeQueue();
            for (int attempt = 0; attempt < 30; attempt++) {
                redis.delete(RedisKeys.seaEnterAttempt(userId));
                session.send("/app/sea/enter", Map.of());
                Map<String, Object> assigned = assignments.poll(500, TimeUnit.MILLISECONDS);
                if (assigned != null) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> body = (Map<String, Object>) assigned.get("payload");
                    assigned.put("roomId", body.get("roomId"));
                    assignments.clear();
                    return assigned;
                }
            }
            throw new AssertionError("배정이 끝내 오지 않았다 — errors=" + errors);
        }

        /** 방 토픽을 구독하고, 자기 한마디 사건이 도착할 때까지 다시 보내 등록을 확인한다. */
        BlockingQueue<Map<String, Object>> watch(UUID room, UUID self) throws Exception {
            BlockingQueue<Map<String, Object>> queue = new LinkedBlockingQueue<>();
            subscription = session.subscribe("/topic/sea/rooms/" + room, new QueueHandler(queue));
            for (int attempt = 0; attempt < 30; attempt++) {
                postSea(self, "remark", "등록 확인 " + attempt);
                if (queue.poll(500, TimeUnit.MILLISECONDS) != null) {
                    while (queue.poll(300, TimeUnit.MILLISECONDS) != null) {
                        continue;
                    }
                    return queue;
                }
            }
            throw new AssertionError("방 토픽 구독이 끝내 등록되지 않았다 — errors=" + errors);
        }
    }

    private static final class QueueHandler implements StompFrameHandler {

        private final BlockingQueue<Map<String, Object>> queue;

        QueueHandler(BlockingQueue<Map<String, Object>> queue) {
            this.queue = queue;
        }

        @Override
        public @NonNull Type getPayloadType(@NonNull StompHeaders headers) {
            return Map.class;
        }

        @Override
        @SuppressWarnings("unchecked")
        public void handleFrame(@NonNull StompHeaders headers, Object payload) {
            queue.add(new HashMap<>((Map<String, Object>) payload));
        }
    }
}

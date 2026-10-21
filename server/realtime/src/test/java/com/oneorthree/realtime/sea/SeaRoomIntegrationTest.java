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
    private com.oneorthree.realtime.block.BlockedUsers blockedUsers;

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
    @DisplayName("[2330] member 에 name·catColor — snapshot·joined 에 실리고, 털색 미선택·옛 해시는 null")
    void memberCarriesNameAndCatColor() throws Exception {
        Instant now = Instant.now();
        UUID alice = UUID.randomUUID();
        UUID bob = UUID.randomUUID();
        given(seaState.fetch(alice)).willReturn(new SeaStateClient.SeaState(null, null,
                new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now), "앨리스", "ginger"));
        given(seaState.fetch(bob)).willReturn(new SeaStateClient.SeaState(null, null,
                new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now), "밥", null));
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());
        given(friends.fetchFriendIds(bob)).willReturn(Set.of());
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        BlockingQueue<Map<String, Object>> heard = a.watch(room, alice);

        connect(bob).enter();

        Map<String, Object> joined = memberOf(await(heard, frame -> "sea.member.joined".equals(frame.get("type"))));
        assertThat(joined.get("name")).isEqualTo("밥");
        assertThat(joined).containsKey("catColor");
        assertThat(joined.get("catColor")).isNull();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> before = (List<Map<String, Object>>) payload(a.sync()).get("members");
        Map<String, Object> aliceNow = before.stream().filter(m -> alice.toString().equals(m.get("userId")))
                .findFirst().orElseThrow();
        assertThat(aliceNow.get("name")).isEqualTo("앨리스");
        assertThat(aliceNow.get("catColor")).isEqualTo("ginger");
        redis.opsForHash().delete(RedisKeys.seaUser(alice), "name", "catColor"); // 배포 전 입장한 옛 해시
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> members = (List<Map<String, Object>>) payload(a.sync()).get("members");
        Map<String, Object> old = members.stream().filter(m -> alice.toString().equals(m.get("userId"))).findFirst()
                .orElseThrow();
        assertThat(old).containsKeys("name", "catColor");
        assertThat(old.get("name")).isNull();
        Map<String, Object> fresh = members.stream().filter(m -> bob.toString().equals(m.get("userId"))).findFirst()
                .orElseThrow();
        assertThat(fresh.get("name")).isEqualTo("밥");
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
    @DisplayName("[2389] 방 안 외양 사건 — 섬 없는 사용자 축 사건도 반영되고, 차단한 구성원에게만 head·neck 이 null 로 간다, 옛 version 은 무시")
    void appearanceEventIsMaskedPerViewerAndOrdered() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        UUID carol = sailor();
        Client a = connect(alice);
        Client b = connect(bob);
        Client c = connect(carol);
        UUID room = roomOf(a.enter());
        assertThat(roomOf(b.enter())).isEqualTo(room);
        assertThat(roomOf(c.enter())).isEqualTo(room);
        BlockingQueue<Map<String, Object>> heardByAlice = a.watch(room, alice);
        BlockingQueue<Map<String, Object>> heardByCarol = c.watch(room, carol);
        // 입장 뒤에 alice 가 bob 을 차단했다 — 세대를 올려 캐시된 빈 집합을 버린다.
        given(blockClient.fetchBlockedIds(alice)).willReturn(Set.of(bob));
        blockedUsers.advanceGeneration(alice);

        postEvent(appearanceEvent(bob, null, 2, "head-new"));

        Map<String, Object> forAlice = await(heardByAlice, frame -> "sea.member.updated".equals(frame.get("type"))
                && bob.toString().equals(memberOf(frame).get("userId")));
        Map<String, Object> forCarol = await(heardByCarol, frame -> "sea.member.updated".equals(frame.get("type"))
                && bob.toString().equals(memberOf(frame).get("userId")));
        assertThat(lookOf(forAlice)).containsEntry("head", null).containsEntry("neck", null);
        assertThat(lookOf(forCarol)).containsEntry("head", "head-new");
        // 옛 version(1) 이 뒤늦게 와도 덮지 않는다
        postEvent(appearanceEvent(bob, UUID.randomUUID(), 1, "head-old"));
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(bob), "head")).isEqualTo("head-new");
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(bob), "appearanceVersion")).isEqualTo("2");
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

    @Test
    @DisplayName("[rev CAS] 재조회 응답 전에 Data 사건이 먼저 적용되면 오래된 재조회 결과로 덮어쓰지 않는다")
    void staleRefetchDoesNotOverwriteANewerEvent() throws Exception {
        UUID alice = UUID.randomUUID();
        UUID newer = UUID.randomUUID();
        Instant now = Instant.now();
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());
        given(seaState.fetch(alice)).willAnswer(invocation -> {
            if (calls.incrementAndGet() == 1) {
                return new SeaStateClient.SeaState(null, null,
                        new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now));
            }
            // 재조회가 돌아오기 전에 «항해 끝 → 새 항해» 사건이 먼저 적용된다. 재조회 응답은 그 사이 시점의 낡은 「끝남」.
            postEvent(seaEvent(alice, "\"status\":\"sailing\",\"sessionId\":\"" + newer + "\","
                    + "\"destinationIslandId\":\"" + destination + "\",\"sailingMinutes\":30,\"activeSeconds\":0,"
                    + "\"serverNow\":\"" + Instant.now() + "\""));
            return new SeaStateClient.SeaState(null, null, null);
        });

        connect(alice).enter();

        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "state")).isEqualTo("focusing");
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "sessionId")).isEqualTo(newer.toString());
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, alice.toString())).isNull();
    }

    @Test
    @DisplayName("[보정] 두 조회 사이 한마디가 바뀌었으면 세션이 같아도 입장 뒤 한마디를 맞춘다")
    void remarkChangedBetweenFetchesIsApplied() throws Exception {
        UUID alice = UUID.randomUUID();
        Instant now = Instant.now();
        SeaStateClient.Session session = new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now);
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());
        given(seaState.fetch(alice)).willReturn(new SeaStateClient.SeaState("옛말", now, session),
                new SeaStateClient.SeaState("새말", now.plusSeconds(1), session));

        connect(alice).enter();

        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "remark")).isEqualTo("새말");
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "sessionId"))
                .isEqualTo(session.sessionId().toString());
    }

    @Test
    @DisplayName("[보정] 두 조회 사이 이름·털색이 바뀌었으면 입장 뒤 snapshot 의 member 가 두 번째 값이다(털색은 HDEL)")
    void profileChangedBetweenFetchesIsApplied() throws Exception {
        UUID alice = UUID.randomUUID();
        Instant now = Instant.now();
        SeaStateClient.Session session = new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now);
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());
        given(seaState.fetch(alice)).willReturn(new SeaStateClient.SeaState(null, null, session, "앨리스", "ginger"),
                new SeaStateClient.SeaState(null, null, session, "앨리", null));

        Client a = connect(alice);
        a.enter();

        @SuppressWarnings("unchecked")
        Map<String, Object> member = ((List<Map<String, Object>>) payload(a.sync()).get("members")).get(0);
        assertThat(member.get("name")).isEqualTo("앨리");
        assertThat(member.get("catColor")).isNull();
        assertThat(redis.opsForHash().hasKey(RedisKeys.seaUser(alice), "catColor")).isFalse();
    }

    @Test
    @DisplayName("[재확인] 재조회 중 소켓이 끊기면 joined 를 내지 않고 구성원에서도 빠진다")
    void disconnectDuringRefetchPublishesNoJoined() throws Exception {
        UUID bob = sailor();
        Client b = connect(bob);
        UUID room = roomOf(b.enter());
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);

        UUID alice = UUID.randomUUID();
        Instant now = Instant.now();
        SeaStateClient.SeaState sailing = new SeaStateClient.SeaState(null, null,
                new SeaStateClient.Session(UUID.randomUUID(), destination, 30, 0L, now, now));
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());
        Client a = connect(alice);
        java.util.concurrent.CountDownLatch refetching = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        given(seaState.fetch(alice)).willAnswer(invocation -> {
            if (calls.incrementAndGet() > 1) {
                refetching.countDown();
                a.session.disconnect();
                Thread.sleep(1500); // 서버가 소켓 종료를 처리할 시간
            }
            return sailing;
        });
        a.subscribeQueue();
        redis.delete(RedisKeys.seaEnterAttempt(alice));
        a.session.send("/app/sea/enter", Map.of());

        assertThat(refetching.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isTrue();
        awaitTrue(() -> calls.get() >= 2);
        Thread.sleep(2000);
        Map<String, Object> frame;
        while ((frame = heardByBob.poll(300, TimeUnit.MILLISECONDS)) != null) {
            assertThat(frame.get("type")).as("joined 가 나가면 안 된다").isNotEqualTo("sea.member.joined");
        }
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), alice.toString())).isFalse();
        assertThat(redis.hasKey(RedisKeys.seaUser(alice))).isFalse();
    }

    @Test
    @DisplayName("[스냅샷] 옛 SET 에 남은 id(해시는 다른 방)는 스냅샷에 섞이지 않고 SET 에서 치워진다")
    void snapshotSkipsGhostsFromAnotherRoom() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        UUID ghost = UUID.randomUUID();
        redis.opsForSet().add(RedisKeys.seaRoomMembers(room), ghost.toString());
        redis.opsForHash().putAll(RedisKeys.seaUser(ghost), Map.of("roomId", UUID.randomUUID().toString(),
                "state", "focusing"));

        assertThat(memberIds(payload(a.sync()))).containsExactly(alice.toString());
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), ghost.toString())).isFalse();
    }

    @Test
    @DisplayName("[r1-6] 방 토픽을 구독하지 않은 세션의 sync 는 NOT_IN_SEA_ROOM — 「SUB room → sync」 순서 강제")
    void syncWithoutRoomSubscriptionIsRejected() throws Exception {
        UUID alice = sailor();
        Client a = connect(alice);
        a.enter();
        BlockingQueue<SendFailureResponse> failures = a.subscribeErrors();

        SendFailureResponse failure = null;
        for (int attempt = 0; attempt < 20 && failure == null; attempt++) {
            a.session.send("/app/sea/sync", Map.of());
            failure = failures.poll(500, TimeUnit.MILLISECONDS);
        }
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.NOT_IN_SEA_ROOM.name());
        assertThat(a.assignments.poll(300, TimeUnit.MILLISECONDS)).as("스냅샷은 가지 않는다").isNull();
        assertThat(a.sync().get("type")).as("구독한 뒤엔 받는다").isEqualTo("sea.room.snapshot");
    }

    @Test
    @DisplayName("[r1-3] remark 키 없음·문자열 아님은 무시, 명시적 null·\"\" 만 지운다. sailing 필수 필드 불량은 무시")
    void malformedMemberEventsAreIgnored() throws Exception {
        UUID alice = UUID.randomUUID();
        Instant now = Instant.now();
        UUID sessionId = UUID.randomUUID();
        given(friends.fetchFriendIds(alice)).willReturn(Set.of());
        given(seaState.fetch(alice)).willReturn(new SeaStateClient.SeaState("한마디", now,
                new SeaStateClient.Session(sessionId, destination, 30, 0L, now, now)));
        connect(alice).enter();
        String key = RedisKeys.seaUser(alice);

        postEvent(seaEvent(alice, "\"status\":\"remark\""));
        postEvent(seaEvent(alice, "\"status\":\"remark\",\"remark\":7"));
        assertThat(redis.opsForHash().get(key, "remark")).as("키 없음·숫자는 지우지 않는다").isEqualTo("한마디");

        String good = "\"sessionId\":\"" + UUID.randomUUID() + "\",\"serverNow\":\"2026-10-17T00:00:00Z\"";
        postEvent(seaEvent(alice, "\"status\":\"sailing\"," + good
                + ",\"destinationIslandId\":\"" + destination + "\",\"sailingMinutes\":30"));            // activeSeconds 없음
        postEvent(seaEvent(alice, "\"status\":\"sailing\"," + good
                + ",\"activeSeconds\":\"5\",\"destinationIslandId\":\"" + destination + "\",\"sailingMinutes\":30"));
        postEvent(seaEvent(alice, "\"status\":\"sailing\"," + good + ",\"activeSeconds\":5,\"sailingMinutes\":30"));
        postEvent(seaEvent(alice, "\"status\":\"sailing\"," + good
                + ",\"activeSeconds\":5,\"destinationIslandId\":\"" + destination + "\",\"sailingMinutes\":\"30\""));
        assertThat(redis.opsForHash().get(key, "sessionId")).as("불량 sailing 은 무시").isEqualTo(sessionId.toString());
        assertThat(redis.opsForHash().get(key, "destinationIslandId")).isEqualTo(destination.toString());
        assertThat(redis.opsForHash().get(key, "sailingMinutes")).isEqualTo("30");

        postEvent(seaEvent(alice, "\"status\":\"remark\",\"remark\":null"));
        assertThat(redis.opsForHash().get(key, "remark")).as("명시적 null 은 지운다").isNull();
    }

    @Test
    @DisplayName("[r1-4] 같은 ended 가 두 번 와도 adriftSince 는 사건 occurredAt 으로 같다(멱등)")
    void endedIsIdempotentOnOccurredAt() throws Exception {
        UUID alice = sailor();
        connect(alice).enter();
        String ended = "{\"eventId\":\"%s\",\"schemaVersion\":1,\"type\":\"sea.member.updated\","
                + "\"occurredAt\":\"2026-10-17T01:02:03Z\",\"scheduledAt\":null,\"userId\":\"" + alice + "\","
                + "\"locale\":null,\"subjectId\":\"" + alice + "\",\"version\":2,\"params\":{\"status\":\"ended\"}}";

        postEvent(String.format(ended, UUID.randomUUID()));
        Object first = redis.opsForHash().get(RedisKeys.seaUser(alice), "adriftSince");
        Thread.sleep(20);
        postEvent(String.format(ended, UUID.randomUUID())); // relay 재전달(수신 기록이 롤백된 경우)

        assertThat(first).isEqualTo(Long.toString(Instant.parse("2026-10-17T01:02:03Z").toEpochMilli()));
        assertThat(redis.opsForHash().get(RedisKeys.seaUser(alice), "adriftSince")).isEqualTo(first);
    }

    @Test
    @DisplayName("[r1-9] 한 기기의 leave 는 같은 사용자의 다른 기기 /user/queue/sea 에 sea.room.left 로 알려진다")
    void leaveNotifiesTheOtherDevice() throws Exception {
        UUID alice = sailor();
        Client phone = connect(alice);
        UUID room = roomOf(phone.enter());
        Client tablet = connect(alice);
        assertThat(roomOf(tablet.enter())).isEqualTo(room);

        phone.session.send("/app/sea/leave", Map.of());

        Map<String, Object> notice = await(tablet.assignments, frame -> "sea.room.left".equals(frame.get("type")));
        assertThat(payload(notice)).containsEntry("roomId", room.toString()).containsEntry("reason", "left");
    }

    @Test
    @DisplayName("[r1-2] 두 기기가 동시에 끊겨도 퇴장은 한 번 — left{disconnected} 1건, 유령 없음")
    void simultaneousDisconnectLeavesOnce() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client phone = connect(alice);
        UUID room = roomOf(phone.enter());
        Client tablet = connect(alice);
        tablet.enter();
        Client b = connect(bob);
        b.enter();
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);

        java.util.concurrent.CompletableFuture.allOf(
                java.util.concurrent.CompletableFuture.runAsync(phone.session::disconnect),
                java.util.concurrent.CompletableFuture.runAsync(tablet.session::disconnect)).get(5, TimeUnit.SECONDS);

        await(heardByBob, frame -> "sea.member.left".equals(frame.get("type")));
        Map<String, Object> extra;
        while ((extra = heardByBob.poll(1, TimeUnit.SECONDS)) != null) {
            assertThat(extra.get("type")).as("left 는 한 번").isNotEqualTo("sea.member.left");
        }
        assertThat(redis.hasKey(RedisKeys.seaUser(alice))).isFalse();
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), alice.toString())).isFalse();
    }

    @Test
    @DisplayName("[r3-3] 차단 판정이 실패하면(fail-closed) 후보 방이 있어도 빼고 새 방으로 간다")
    void undecidableBlockExcludesTheCandidate() throws Exception {
        UUID resident = UUID.randomUUID();
        UUID candidate = preloadRoom(Map.of(resident, destination)); // 같은 목적지 — 막히지 않았다면 1순위
        given(blockClient.fetchBlockedIds(resident)).willThrow(new UpstreamUnavailableException());

        UUID alice = sailor();
        UUID room = roomOf(connect(alice).enter());

        assertThat(room).isNotEqualTo(candidate);
        assertThat(redis.opsForSet().members(RedisKeys.seaRoomMembers(candidate))).containsExactly(resident.toString());
        assertThat(redis.opsForSet().isMember(RedisKeys.SEA_ROOMS_OPEN, candidate.toString())).isTrue();
    }

    @Test
    @DisplayName("[2299] user.withdrawn 이면 바다 방에서도 내보낸다 — left{left}·해시·SET·색인 정리, 방 밖이면 200·사건 0")
    void withdrawalLeavesTheSeaRoom() throws Exception {
        UUID alice = sailor();
        UUID bob = sailor();
        Client a = connect(alice);
        UUID room = roomOf(a.enter());
        Client b = connect(bob);
        b.enter();
        BlockingQueue<Map<String, Object>> heardByBob = b.watch(room, bob);
        redis.opsForZSet().add(RedisKeys.SEA_ADRIFT, alice.toString(), 1); // 색인에 있던 경우도 지워지는지

        postEvent(withdrawn(alice));

        Map<String, Object> left = await(heardByBob, frame -> "sea.member.left".equals(frame.get("type")));
        assertThat(payload(left)).containsEntry("userId", alice.toString()).containsEntry("reason", "left");
        assertThat(redis.hasKey(RedisKeys.seaUser(alice))).isFalse();
        assertThat(redis.opsForSet().isMember(RedisKeys.seaRoomMembers(room), alice.toString())).isFalse();
        assertThat(redis.opsForZSet().score(RedisKeys.SEA_ADRIFT, alice.toString())).isNull();

        UUID outsider = UUID.randomUUID();
        postEvent(withdrawn(outsider)); // 바다 밖 — 200, 방 사건 없음
        assertThat(heardByBob.poll(1, TimeUnit.SECONDS)).isNull();
        assertThat(redis.hasKey(RedisKeys.seaUser(outsider))).isFalse();
    }

    /** Data 의 탈퇴 정본 봉투 — {@code InboundEventServiceTest#withdrawn} 과 같은 모양. */
    private static String withdrawn(UUID user) {
        return "{\"eventId\":\"user.withdrawn:" + user + "\",\"schemaVersion\":1,\"type\":\"user.withdrawn\","
                + "\"occurredAt\":\"2026-10-17T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":7,"
                + "\"params\":{\"userId\":\"" + user + "\",\"authGeneration\":1}}";
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

    /** member.appearance.updated — subjectId 가 null 이면 섬이 없는 사용자 축 사건이다(GROMO-2389). */
    private static String appearanceEvent(UUID user, UUID island, long version, String head) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,\"type\":\"member.appearance.updated\","
                + "\"occurredAt\":\"2026-10-17T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":" + (island == null ? "null" : "\"" + island + "\"")
                + ",\"version\":" + version + ",\"params\":{\"userId\":\"" + user + "\",\"appearance\":{"
                + "\"clothes\":null,\"decor\":null,\"head\":\"" + head + "\",\"neck\":null,\"shoes\":null,"
                + "\"hull\":\"raft\",\"position\":\"front\"},\"version\":" + version + "}}";
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> lookOf(Map<String, Object> frame) {
        return (Map<String, Object>) memberOf(frame).get("appearance");
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
        private UUID lastRoom;

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
            if (subscription == null && lastRoom != null) {
                // 계약 §5: SUB room → sync. 서버가 이 순서를 강제한다(구독 없는 sync 는 NOT_IN_SEA_ROOM).
                subscription = session.subscribe("/topic/sea/rooms/" + lastRoom,
                        new QueueHandler(new LinkedBlockingQueue<>()));
            }
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
                if (assigned != null && "sea.room.assigned".equals(assigned.get("type"))) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> body = (Map<String, Object>) assigned.get("payload");
                    assigned.put("roomId", body.get("roomId"));
                    lastRoom = UUID.fromString((String) body.get("roomId"));
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

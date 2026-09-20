package com.oneorthree.realtime;

import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.event.FocusEmoteType;
import com.oneorthree.realtime.focus.IslandFocusSessions;
import com.oneorthree.realtime.focus.dto.FocusEmoteRequest;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.dto.SendFailureResponse;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
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
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 실시간 배선이 <b>끝에서 끝까지</b> 이어졌는지 (GROMO-1765) — 실 소켓·실 Redis·실 DB.
 *
 * <p>여기서 보는 것은 단위 테스트가 절대 못 보는 것들이다: 허용목록을 열어도 아웃바운드 인터셉터가
 * 막고 있지는 않은지, {@code EventRouter} 가 계산한 목적지가 앱이 실제로 구독하는 문자열과 같은지,
 * Data 의 HTTP 수신구로 들어온 사건이 <b>소켓까지</b> 나가는지. 그 사이 배선 하나만 빠져도 조용히
 * 아무 일도 일어나지 않는다.
 *
 * <p>스텁은 하나뿐이다 — {@link IslandFocusSessions}, Data API 로 나가는 <b>네트워크 경계</b>다
 * ({@code GroupClient} 를 목으로 두는 기존 테스트들과 같은 층이다). 배선 이음매
 * ({@code RealtimeDelivery}·{@code EventRouter}·인터셉터)는 전부 운영 빈 그대로다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class IslandRealtimeIntegrationTest {

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

    /** 응원 인가의 Data 정본 — 이 테스트가 바꾸는 유일한 경계다. */
    @MockitoBean
    private IslandFocusSessions focusSessions;

    /** legacy 채팅 상류. 섬 목적지는 이 경로를 타지 않는다 — 실제로 호출되면 그게 결함이다. */
    @MockitoBean
    private GroupClient groupClient;

    private WebSocketStompClient stompClient;
    private UUID island;
    private UUID focusing;
    private UUID resting;
    private UUID visitor;
    private final Map<UUID, String> bearers = new HashMap<>();

    /** 정본이 돌려주는 「그 섬에서 지금 진행 중인 주민」. 전달 직전 판정이 이 집합으로 이뤄진다. */
    private void givenProgressing(UUID... users) {
        given(focusSessions.requireActiveSession(any(), any(), any())).willReturn(Set.of(users));
    }

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        focusing = UUID.randomUUID();
        resting = UUID.randomUUID();
        visitor = UUID.randomUUID();
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new CompositeMessageConverter(
                List.of(new JacksonJsonMessageConverter(), new SimpleMessageConverter())));
        givenProgressing(focusing, resting);
    }

    @AfterEach
    void tearDown() {
        redis.delete(RedisKeys.focusPresence(focusing));
        clearWindows(focusing);
        clearWindows(resting);
        stompClient.stop();
    }

    @Test
    @DisplayName("같은 섬의 진행 중 주민이 5종을 보내고 구독자가 3초 TTL 봉투로 받는다")
    void progressingResidentSendsAllFiveEmoteTypes() throws Exception {
        UUID sessionId = UUID.randomUUID();
        StompSession sender = connect(focusing);
        BlockingQueue<Map<String, Object>> emotes = subscribe(sender, "emotes");
        awaitEmoteSubscription(sender, sessionId, emotes);

        for (FocusEmoteType type : FocusEmoteType.values()) {
            // 두 창이 지난 것과 같다 — 시도 창(사용자 600ms)과 성공 창(사용자×섬 3초)이 따로 있다.
            clearWindows(focusing);
            sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, type.wireName()));

            Map<String, Object> envelope = emotes.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            assertThat(envelope).as("응원 %s 가 섬 토픽으로 나가야 한다", type.wireName()).isNotNull();
            assertThat(envelope).containsOnlyKeys("eventId", "schemaVersion", "type", "islandId",
                    "aggregateVersion", "occurredAt", "payload");
            assertThat(envelope.get("type")).isEqualTo("focus.emote");
            assertThat(envelope.get("islandId")).isEqualTo(island.toString());
            assertThat(envelope.get("aggregateVersion")).as("순간 사건은 병합할 투영 버전이 없다").isNull();

            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
            assertThat(payload.get("userId")).as("발신자는 본문이 아니라 세션에서 온다").isEqualTo(focusing.toString());
            assertThat(payload.get("sessionId")).isEqualTo(sessionId.toString());
            assertThat(payload.get("type")).isEqualTo(type.wireName());
            assertThat(Instant.parse((String) payload.get("expiresAt")))
                    .as("서버가 만든 만료는 occurredAt + 3초다")
                    .isEqualTo(Instant.parse((String) envelope.get("occurredAt")).plusSeconds(3));
        }
        // 「그 섬의 본인 진행 세션인가」는 매번 Data 정본에 묻는다 — TTL 캐시가 아니다.
        verify(focusSessions, org.mockito.Mockito.atLeast(FocusEmoteType.values().length))
                .requireActiveSession(island, focusing, sessionId);
    }

    @Test
    @DisplayName("휴식(paused) 중인 주민이 보낸 응원도 같은 섬의 다른 주민에게 도착한다")
    void restingResidentEmoteReachesTheIsland() throws Exception {
        // 모닥불에 앉은 사람이 집중하는 사람을 응원한다 — 2026-09-20 결정의 본 시나리오다.
        // 인가 술어(paused 통과)는 IslandFocusSessionsTest 가 실 HTTP 로 본다. 여기서 보는 것은
        // 「그 판정이 통과했을 때 프레임이 실제로 남의 소켓까지 가는가」다.
        UUID restingSession = UUID.randomUUID();
        StompSession receiver = connect(focusing);
        BlockingQueue<Map<String, Object>> received = subscribe(receiver, "emotes");
        StompSession sender = connect(resting);
        awaitEmoteSubscription(sender, restingSession, received, resting);

        sender.send(emoteDestination(), new FocusEmoteRequest(restingSession, "cheer"));

        Map<String, Object> envelope = received.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(envelope).as("휴식자의 응원이 섬에 나가야 한다").isNotNull();
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
        assertThat(payload.get("userId")).isEqualTo(resting.toString());
        assertThat(payload.get("sessionId")).isEqualTo(restingSession.toString());
        assertThat(payload.get("type")).isEqualTo("cheer");
        // 구독 등록 확인용 버리는 응원도 같은 판정을 타므로 횟수를 고정하지 않는다 — 보는 것은
        // 「휴식자의 sessionId 로 Data 정본을 물었다」이지 몇 번 물었는지가 아니다.
        verify(focusSessions, org.mockito.Mockito.atLeastOnce())
                .requireActiveSession(island, resting, restingSession);
    }

    @Test
    @DisplayName("같은 3초 창의 두 번째 응원은 429 로 거절되고 섬에 나가지 않는다")
    void secondEmoteInTheSameWindowIsRejected() throws Exception {
        UUID sessionId = UUID.randomUUID();
        StompSession sender = connect(focusing);
        BlockingQueue<Map<String, Object>> emotes = subscribe(sender, "emotes");
        BlockingQueue<SendFailureResponse> errors = subscribeToErrors(sender);
        awaitEmoteSubscription(sender, sessionId, emotes);
        clearWindows(focusing);

        sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, "cheer"));
        assertThat(emotes.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isNotNull();

        sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, "hearts"));
        SendFailureResponse failure = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.EMOTE_TOO_FREQUENT.name());
        assertThat(emotes.poll(1, TimeUnit.SECONDS)).as("거절된 응원은 섬에 나가지 않는다").isNull();
    }

    @Test
    @DisplayName("5종 밖의 종류는 422 의미로 거절한다 — 아무 문자열이나 섬 전체에 방송되지 않는다")
    void unknownEmoteTypeIsRejected() throws Exception {
        UUID sessionId = UUID.randomUUID();
        StompSession sender = connect(focusing);
        BlockingQueue<Map<String, Object>> emotes = subscribe(sender, "emotes");
        BlockingQueue<SendFailureResponse> errors = subscribeToErrors(sender);
        awaitEmoteSubscription(sender, sessionId, emotes);
        clearWindows(focusing);
        org.mockito.Mockito.clearInvocations(focusSessions);

        sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, "angry"));

        SendFailureResponse failure = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.INVALID_EMOTE_TYPE.name());
        assertThat(emotes.poll(1, TimeUnit.SECONDS)).isNull();
        // 검사 순서가 시도 창 → 형식 → 인가라 계약 밖의 type 은 상류에 닿지도 않는다.
        verify(focusSessions, org.mockito.Mockito.never()).requireActiveSession(any(), eq(focusing), any());
        // 그리고 거절은 «성공» 창을 먹지 않는다 — 오타 한 번이 정상 응원을 3초 막으면 안 된다.
        // (시도 창을 먹는지는 rejectedAttemptsDoNotMultiplyUpstreamCalls 가 본다 — 600ms 라
        //  여기서 단언하면 앞선 poll 들이 흐른 시간 때문에 이미 만료돼 있다.)
        assertThat(redis.hasKey(RedisKeys.emoteRateLimit(island, focusing))).isFalse();
    }

    @Test
    @DisplayName("거절 연타도 시도 창을 소모한다 — 임의의 섬 UUID 를 바꿔 가며 보내도 상류 조회가 늘지 않는다")
    void rejectedAttemptsDoNotMultiplyUpstreamCalls() throws Exception {
        // P1-②: 섬을 키에 넣으면 매번 새 UUID 로 제한을 비켜 가 거절 하나하나가 Data 조회 하나가 된다.
        StompSession sender = connect(focusing);
        BlockingQueue<SendFailureResponse> errors = subscribeToErrors(sender);
        awaitErrorQueueRegistered(sender, errors, focusing);
        // 남의 섬이니 정본은 거절한다. 그래도 «거절하려면 물어봐야» 하고, 그 조회가 비용이다.
        willThrow(new ChatException(ChatErrorCode.NOT_FOCUSING))
                .given(focusSessions).requireActiveSession(any(), eq(focusing), any());
        org.mockito.Mockito.clearInvocations(focusSessions);

        int frames = 12;
        for (int attempt = 0; attempt < frames; attempt++) {
            sender.send("/app/islands/" + UUID.randomUUID() + "/focus/emotes",
                    new FocusEmoteRequest(UUID.randomUUID(), "cheer"));
        }
        // 마지막 프레임까지 «처리가 끝났음»을 관측한 뒤에 센다 — 안 그러면 「아직 안 왔다」를
        // 「상류를 안 불렀다」로 읽어 테스트가 거짓 초록이 된다.
        for (int i = 0; i < frames; i++) {
            assertThat(errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                    .as("%d 번째 프레임도 개인 큐로 답을 받아야 한다", i).isNotNull();
        }
        // 시도 창이 «사용자» 축이라 섬 UUID 를 12번 바꿔도 상류에는 창 하나 분량만 나간다.
        // 12번 중 몇 번이 창 경계를 넘는지는 실행 속도에 달렸으므로 상한으로 단언한다.
        verify(focusSessions, org.mockito.Mockito.atMost(3))
                .requireActiveSession(any(), eq(focusing), any());
    }

    @Test
    @DisplayName("만료된 토큰의 세션은 섬 프레임을 하나도 받지 못하고 소켓이 닫힌다")
    void expiredTokenStopsIslandEgressAndClosesTheSocket() throws Exception {
        // P1-①: 섬 채널은 오래 열려 있는 구독이라 SUBSCRIBE 때 유효하던 AT 가 그 뒤 만료된다.
        Instant expiry = Instant.now().plusSeconds(3);
        String shortLived = bearerExpiringAt(focusing, expiry);
        StompSession session = connectWith(shortLived);
        BlockingQueue<Map<String, Object>> focus = subscribe(session, "focus");
        awaitFocusEvent(focus, "active", 1);

        while (Instant.now().isBefore(expiry.plusMillis(500))) {
            Thread.sleep(100);
        }
        focus.clear();
        postFocusMemberEvent("paused", 2);

        assertThat(focus.poll(3, TimeUnit.SECONDS)).as("만료 후 egress 는 0 이다").isNull();
        // 종료는 서버가 밀고 클라이언트가 알아채는 두 단계라 즉시가 아니다.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (session.isConnected() && System.nanoTime() < deadline) {
            Thread.sleep(100);
        }
        assertThat(session.isConnected()).as("소켓도 닫아야 앱이 갱신·재연결을 시작한다").isFalse();
    }

    @Test
    @DisplayName("schema 2 · userId 누락 · 계약 밖 status 인 주민 사건은 200 으로 받되 방송하지 않는다")
    void malformedMemberEventsAreAcceptedButNeverBroadcast() throws Exception {
        // P2-①: 서비스 토큰은 「Data 가 보냈다」만 증명한다 — 내용이 계약을 지킨다는 보증이 아니다.
        StompSession watcher = connect(focusing);
        BlockingQueue<Map<String, Object>> focus = subscribe(watcher, "focus");
        awaitFocusEvent(focus, "active", 1);

        String schemaTwo = focusMemberEvent(UUID.randomUUID().toString(), "paused", 11)
                .replace("\"schemaVersion\":1", "\"schemaVersion\":2");
        String missingUserId = focusMemberEvent(UUID.randomUUID().toString(), "paused", 12)
                .replace(",\"params\":{\"userId\":\"" + focusing + "\"", ",\"params\":{\"noUserId\":\"\"");
        String badStatus = focusMemberEvent(UUID.randomUUID().toString(), "napping", 13);

        for (String body : new String[] {schemaTwo, missingUserId, badStatus}) {
            // 400 이 아니라 200 이다 — 400 은 relay 가 permanent 로 적어 그 순서 축을 영영 막는다.
            postEvent(body);
        }
        assertThat(focus.poll(3, TimeUnit.SECONDS)).as("계약을 어긴 사건은 앱에 가지 않는다").isNull();

        // 그리고 그 뒤 정상 사건은 여전히 흐른다 — 검증이 축을 막아 버리지 않았다.
        assertThat(awaitFocusEvent(focus, "paused", 14)).isNotNull();
    }

    @Test
    @DisplayName("본문이 깨진 응원은 개인 큐로 INVALID_REQUEST 를 받고 연결이 살아 있다")
    void malformedEmoteBodyGoesToThePersonalQueue() throws Exception {
        // P2-②: 변환·@Valid 는 메서드에 «들어가기 전»에 터져 컨트롤러의 try/catch 에 닿지 못한다.
        StompSession sender = connect(focusing);
        BlockingQueue<SendFailureResponse> errors = subscribeToErrors(sender);
        awaitErrorQueueRegistered(sender, errors, focusing);

        clearWindows(focusing);
        sender.send(emoteDestination(), new FocusEmoteRequest(null, "cheer"));
        SendFailureResponse missingSession = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(missingSession).isNotNull();
        assertThat(missingSession.getCode()).isEqualTo(CommonErrorCode.INVALID_REQUEST.name());
        assertThat(sender.isConnected()).as("필드 하나를 빠뜨렸다고 세션이 죽으면 안 된다").isTrue();

        clearWindows(focusing);
        sender.send(emoteDestination(), Map.of("sessionId", "not-a-uuid", "type", "cheer"));
        SendFailureResponse malformed = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(malformed).isNotNull();
        assertThat(malformed.getCode()).isEqualTo(CommonErrorCode.INVALID_REQUEST.name());
        assertThat(sender.isConnected()).isTrue();
    }

    @Test
    @DisplayName("프레즌스 키가 없어도 정본상 진행 중이면 응원을 받는다 — 사본의 쓰기 실패가 기능을 죽이지 않는다")
    void missingPresenceLeaseDoesNotBlockAProgressingSubscriber() throws Exception {
        // P1-①: Data 의 리스 «쓰기»는 best-effort 다(CLAUDE.md Contracts 2번). 키 부재를 거절로
        // 확정하면 정상 참가자의 응원이 전부 버려진다.
        assertThat(redis.hasKey(RedisKeys.focusPresence(focusing))).as("리스가 없는 상태를 재현한다").isFalse();
        UUID sessionId = UUID.randomUUID();
        StompSession sender = connect(focusing);
        BlockingQueue<Map<String, Object>> emotes = subscribe(sender, "emotes");
        awaitEmoteSubscription(sender, sessionId, emotes);
        clearWindows(focusing);

        sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, "cheer"));

        assertThat(emotes.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .as("프레즌스가 아니라 정본이 판정한다").isNotNull();
    }

    @Test
    @DisplayName("프레즌스 키가 남아 있어도 정본상 진행 중이 아니면 응원을 받지 못한다")
    void stalePresenceLeaseDoesNotApproveAFinishedSubscriber() throws Exception {
        // P1-①의 반대 방향: 리스 «삭제»가 유실되면 종료한 사용자가 TTL(13시간) 내내 계속 받는다.
        UUID finished = UUID.randomUUID();
        redis.opsForValue().set(RedisKeys.focusPresence(finished), "1", Duration.ofMinutes(5));
        try {
            UUID sessionId = UUID.randomUUID();
            StompSession watcher = connect(finished);
            BlockingQueue<Map<String, Object>> received = subscribe(watcher, "emotes");
            StompSession sender = connect(focusing);
            awaitEmoteSubscription(sender, sessionId, subscribe(sender, "emotes"), focusing);

            // 정본은 focusing 만 진행 중이라고 답한다 — finished 는 리스만 남았다.
            givenProgressing(focusing);
            clearWindows(focusing);
            sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, "cheer"));

            assertThat(received.poll(3, TimeUnit.SECONDS))
                    .as("남은 리스가 승인 근거가 되면 안 된다 — 정본의 수신 집합만이 승인한다").isNull();
        } finally {
            redis.delete(RedisKeys.focusPresence(finished));
            clearWindows(finished);
        }
    }

    @Test
    @DisplayName("subscription id 만 바꾼 emote 구독 연타가 상류 조회를 늘리지 않는다")
    void repeatedEmoteSubscriptionsDoNotMultiplyUpstreamCalls() throws Exception {
        // P1-②: SEND 만 막고 SUBSCRIBE 를 열어 두면 상한이 반쪽이다.
        StompSession session = connect(focusing);
        BlockingQueue<Map<String, Object>> queue = subscribe(session, "emotes");
        awaitEmoteSubscription(session, UUID.randomUUID(), queue);
        redis.delete(RedisKeys.emoteSubscribeAttempt(focusing));
        org.mockito.Mockito.clearInvocations(focusSessions);

        for (int attempt = 0; attempt < 10; attempt++) {
            session.subscribe("/topic/islands/" + island + "/emotes", new DiscardingFrameHandler());
        }
        // 구독은 RECEIPT 가 없어 «처리 완료»를 관측할 수 없으므로, 창보다 넉넉히 기다린 뒤 센다.
        Thread.sleep(1500);

        // 연타는 관문 거절이라 ERROR 프레임 + 연결 종료로 끝난다(기존 SUBSCRIBE 거절과 같은 취급).
        // 그래서 뒤쪽 프레임은 처리조차 되지 않고, 상류에는 창 하나 분량만 나간다 — 그게 이 단언이다.
        verify(focusSessions, org.mockito.Mockito.atMost(3)).requireActiveSession(eq(island), eq(focusing), any());
    }

    @Test
    @DisplayName("휴식 상태와 휴식 필드가 어긋난 rest 사건은 방송하지 않는다")
    void restStateAndNullableFieldsMustAgree() throws Exception {
        // P2-①: 조합을 안 보면 클라이언트가 휴식 행을 추가하지도 제거하지도 못한다.
        StompSession watcher = connect(focusing);
        BlockingQueue<Map<String, Object>> rest = subscribe(watcher, "rest");
        awaitRestEvent(rest, "paused", "\"2026-09-20T00:00:00Z\"", "1", 1);

        // paused 인데 자리·시작 시각이 null · active 인데 값이 남음 — 둘 다 계약 위반이다.
        postEvent(restMemberEvent(UUID.randomUUID().toString(), "paused", "null", "null", 21));
        postEvent(restMemberEvent(UUID.randomUUID().toString(), "active", "\"2026-09-20T00:00:00Z\"", "1", 22));

        assertThat(rest.poll(3, TimeUnit.SECONDS)).as("어긋난 조합은 앱에 가지 않는다").isNull();
        // 정상 조합 둘은 여전히 흐른다 — 검증이 축을 막아 버리지 않았다.
        assertThat(awaitRestEvent(rest, "active", "null", "null", 23)).isNotNull();
    }

    @Test
    @DisplayName("비정규 UUID 로 연 섬 구독은 거절한다 — 통과시키면 구독은 되고 영영 아무것도 못 받는다")
    void nonCanonicalUuidDestinationIsRejected() throws Exception {
        // P2-②: UUID.fromString 은 그룹 폭이 비정규인 36자도 파싱한다.
        StompSession session = connect(focusing);
        session.subscribe("/topic/islands/000000000-000-0000-0000-000000000000/focus",
                new DiscardingFrameHandler());

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (session.isConnected() && System.nanoTime() < deadline) {
            Thread.sleep(100);
        }
        assertThat(session.isConnected()).as("거절은 ERROR 프레임 + 연결 종료로 즉시 드러나야 한다").isFalse();
    }

    @Test
    @DisplayName("재연결하면 직전의 응원을 다시 받지 않는다 — 만료된 말풍선은 복구 대상이 아니다")
    void reconnectDoesNotReplayEmotes() throws Exception {
        UUID sessionId = UUID.randomUUID();
        StompSession first = connect(focusing);
        BlockingQueue<Map<String, Object>> emotes = subscribe(first, "emotes");
        awaitEmoteSubscription(first, sessionId, emotes);
        clearWindows(focusing);
        first.send(emoteDestination(), new FocusEmoteRequest(sessionId, "cheer"));
        assertThat(emotes.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isNotNull();
        first.disconnect();

        StompSession reconnected = connect(focusing);
        BlockingQueue<Map<String, Object>> replayed = subscribe(reconnected, "emotes");

        // 새 구독이 살아 있다는 것부터 보인다 — 그러지 않으면 「아무것도 안 왔다」가 구독 실패와 구분되지 않는다.
        awaitEmoteSubscription(reconnected, sessionId, replayed);
        replayed.clear();
        assertThat(replayed.poll(2, TimeUnit.SECONDS)).as("연결 전의 응원은 복구되지 않는다").isNull();
    }

    @Test
    @DisplayName("소속을 잃으면 응원 구독도 발신도 막힌다")
    void membershipLossBlocksEmoteSubscribeAndSend() throws Exception {
        UUID sessionId = UUID.randomUUID();
        StompSession sender = connect(focusing);
        BlockingQueue<SendFailureResponse> errors = subscribeToErrors(sender);
        awaitErrorQueueRegistered(sender, errors, focusing);

        // Data 정본이 「그 섬의 진행 주민이 아니다」로 바뀐 순간부터다 — 캐시 만료를 기다리지 않는다.
        willThrow(new ChatException(ChatErrorCode.NOT_FOCUSING))
                .given(focusSessions).requireActiveSession(eq(island), eq(focusing), any());

        sender.send(emoteDestination(), new FocusEmoteRequest(sessionId, "cheer"));
        SendFailureResponse failure = errors.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(failure).isNotNull();
        assertThat(failure.getCode()).isEqualTo(ChatErrorCode.NOT_FOCUSING.name());

        // 구독은 ERROR 프레임 + 소켓 종료로 거절된다(관문이 preSend 에서 던진다).
        StompSession subscriber = connect(focusing);
        BlockingQueue<Map<String, Object>> emotes = subscribe(subscriber, "emotes");
        assertThat(emotes.poll(1, TimeUnit.SECONDS)).isNull();
        postFocusMemberEvent("active", 1);
        assertThat(emotes.poll(2, TimeUnit.SECONDS)).isNull();
    }

    @Test
    @DisplayName("비소속 방문자도 focus·rest 를 구독하고 Data 사건을 받는다 — 관전 개방")
    void visitorWatchesFocusAndRest() throws Exception {
        StompSession watcher = connect(visitor);
        BlockingQueue<Map<String, Object>> focus = subscribe(watcher, "focus");

        Map<String, Object> envelope = awaitFocusEvent(focus, "paused", 7);

        assertThat(envelope.get("type")).isEqualTo("focus.member.updated");
        assertThat(envelope.get("islandId")).isEqualTo(island.toString());
        assertThat(envelope.get("aggregateVersion")).as("스냅샷 watermark 와 같은 축이다").isEqualTo(7);
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
        assertThat(payload.get("status")).isEqualTo("paused");
        assertThat(payload.get("userId")).isEqualTo(focusing.toString());
        // 관전에는 상류 조회가 없다 — 인증만으로 열린다.
        org.mockito.Mockito.verifyNoInteractions(groupClient);
    }

    @Test
    @DisplayName("pause·resume·finish 가 POST /internal/events 를 통해 구독자에게 도달한다")
    void lifecycleTransitionsReachSubscribers() throws Exception {
        StompSession watcher = connect(focusing);
        BlockingQueue<Map<String, Object>> focus = subscribe(watcher, "focus");
        awaitFocusEvent(focus, "active", 1);

        long version = 2;
        for (String status : new String[] {"paused", "active", "completed"}) {
            postFocusMemberEvent(status, version++);
            Map<String, Object> envelope = focus.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
            assertThat(envelope).as("%s 전이가 섬 토픽까지 와야 한다", status).isNotNull();
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
            assertThat(payload.get("status")).isEqualTo(status);
        }
    }

    @Test
    @DisplayName("같은 eventId 를 두 번 보내도 한 번만 전달한다 — relay 재전달이 화면을 두 번 흔들지 않는다")
    void redeliveredEventIsDeliveredOnce() throws Exception {
        StompSession watcher = connect(focusing);
        BlockingQueue<Map<String, Object>> focus = subscribe(watcher, "focus");
        awaitFocusEvent(focus, "active", 1);

        String body = focusMemberEvent(UUID.randomUUID().toString(), "paused", 9);
        postEvent(body);
        assertThat(focus.poll(TIMEOUT_SECONDS, TimeUnit.SECONDS)).isNotNull();
        postEvent(body);
        assertThat(focus.poll(2, TimeUnit.SECONDS)).as("두 번째 전달은 접힌다").isNull();
    }

    /**
     * 구독이 «브로커에 등록됐음»을 관측한다 — SUBSCRIBE 에는 RECEIPT 가 없어 기다릴 방법이 없다.
     *
     * <p>버리는 응원을 도착할 때까지 보낸다. 빈도 제한 창이 재시도를 막으므로 매번 창을 지운다.
     */
    private void awaitEmoteSubscription(StompSession session, UUID sessionId,
            BlockingQueue<Map<String, Object>> queue) throws InterruptedException {
        awaitEmoteSubscription(session, sessionId, queue, focusing);
    }

    private void awaitEmoteSubscription(StompSession session, UUID sessionId,
            BlockingQueue<Map<String, Object>> queue, UUID sender) throws InterruptedException {
        for (int attempt = 0; attempt < 30; attempt++) {
            clearWindows(sender);
            session.send(emoteDestination(), new FocusEmoteRequest(sessionId, "hello"));
            if (queue.poll(500, TimeUnit.MILLISECONDS) != null) {
                // 뒤늦게 도착하는 버리는 응원까지 비운다 — 안 비우면 다음 단언이 warm-up 을 본 메시지로 착각한다.
                while (queue.poll(300, TimeUnit.MILLISECONDS) != null) {
                    continue;
                }
                clearWindows(sender);
                return;
            }
        }
        throw new AssertionError("응원 구독이 끝내 등록되지 않았다 — 허용목록·아웃바운드 가드를 의심할 것");
    }

    /** 같은 이유의 focus 채널 버전 — Data 사건을 도착할 때까지 다시 보낸다(eventId 는 매번 새로). */
    private Map<String, Object> awaitFocusEvent(BlockingQueue<Map<String, Object>> queue, String status, long version)
            throws Exception {
        for (int attempt = 0; attempt < 30; attempt++) {
            postFocusMemberEvent(status, version);
            Map<String, Object> received = queue.poll(500, TimeUnit.MILLISECONDS);
            if (received != null) {
                queue.clear();
                return received;
            }
        }
        throw new AssertionError("섬 사건이 끝내 도착하지 않았다 — 전달 배선을 의심할 것");
    }

    /** rest 사건도 focus 와 같은 이유로 도착할 때까지 다시 보낸다. */
    private Map<String, Object> awaitRestEvent(BlockingQueue<Map<String, Object>> queue, String status,
            String restStartedAt, String restSeat, long version) throws Exception {
        for (int attempt = 0; attempt < 30; attempt++) {
            postEvent(restMemberEvent(UUID.randomUUID().toString(), status, restStartedAt, restSeat, version));
            Map<String, Object> received = queue.poll(500, TimeUnit.MILLISECONDS);
            if (received != null) {
                queue.clear();
                return received;
            }
        }
        throw new AssertionError("휴식 사건이 끝내 도착하지 않았다 — 전달 배선을 의심할 것");
    }

    /** {@code FocusMemberEvents#restUpdated} 가 만드는 모양 — nullable 두 필드는 키를 유지한다(LLD §6). */
    private String restMemberEvent(String eventId, String status, String restStartedAt, String restSeat,
            long version) {
        return "{\"eventId\":\"" + eventId + "\",\"schemaVersion\":1,\"type\":\"rest.member.updated\","
                + "\"occurredAt\":\"2026-09-20T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + focusing + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":" + version + ",\"params\":{\"userId\":\"" + focusing + "\","
                + "\"sessionId\":\"" + UUID.randomUUID() + "\",\"status\":\"" + status + "\","
                + "\"restStartedAt\":" + restStartedAt + ",\"restSeat\":" + restSeat + ","
                + "\"serverNow\":\"2026-09-20T00:00:00Z\",\"sessionVersion\":3}}";
    }

    private void postFocusMemberEvent(String status, long version) throws Exception {
        postEvent(focusMemberEvent(UUID.randomUUID().toString(), status, version));
    }

    private void postEvent(String body) throws Exception {
        mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken)).andExpect(status().isOk());
    }

    /** Data outbox 정본 10필드 — {@code FocusMemberEvents#focusUpdated} 가 만드는 모양 그대로다. */
    private String focusMemberEvent(String eventId, String status, long version) {
        return "{\"eventId\":\"" + eventId + "\",\"schemaVersion\":1,\"type\":\"focus.member.updated\","
                + "\"occurredAt\":\"2026-09-20T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + focusing + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":" + version + ",\"params\":{\"userId\":\"" + focusing + "\","
                + "\"sessionId\":\"" + UUID.randomUUID() + "\",\"status\":\"" + status + "\","
                + "\"subject\":\"영어 단어\",\"activeSeconds\":120,"
                + "\"serverNow\":\"2026-09-20T00:00:00Z\",\"sessionVersion\":3}}";
    }

    /**
     * 개인 오류 큐가 «브로커에 등록됐음»을 관측한다 — SUBSCRIBE 에는 RECEIPT 가 없어 기다릴 방법이 없다.
     *
     * <p>버리는 거절을 도착할 때까지 보낸다. <b>잘못된 type</b> 을 쓰는 이유는 그 거절이 인가(상류
     * 조회)보다 <b>앞에서</b> 끝나기 때문이다 — 정상 type 으로 등록을 확인하면 그 확인 자체가
     * {@code requireActiveSession} 호출 수를 부풀려, 「상류 조회가 늘지 않는다」 단언이 무의미해진다.
     */
    private void awaitErrorQueueRegistered(StompSession session, BlockingQueue<SendFailureResponse> errors,
            UUID sender) throws InterruptedException {
        for (int attempt = 0; attempt < 30; attempt++) {
            clearWindows(sender);
            session.send(emoteDestination(), new FocusEmoteRequest(UUID.randomUUID(), "등록-확인용"));
            if (errors.poll(500, TimeUnit.MILLISECONDS) != null) {
                while (errors.poll(300, TimeUnit.MILLISECONDS) != null) {
                    continue;
                }
                clearWindows(sender);
                return;
            }
        }
        throw new AssertionError("개인 오류 큐가 끝내 등록되지 않았다");
    }

    /** 세 창(발신 시도·구독 시도·성공)을 모두 비운다 — 「그 창이 지났다」를 기다리지 않고 재현한다. */
    private void clearWindows(UUID userId) {
        redis.delete(RedisKeys.emoteAttempt(userId));
        redis.delete(RedisKeys.emoteSubscribeAttempt(userId));
        redis.delete(RedisKeys.emoteRateLimit(island, userId));
    }

    private String emoteDestination() {
        return "/app/islands/" + island + "/focus/emotes";
    }

    private StompSession connect(UUID userId) throws Exception {
        return connectWith(bearerOf(userId));
    }

    private StompSession connectWith(String authorization) throws Exception {
        return stompClient.connectAsync("ws://localhost:" + port + "/ws/realtime",
                        new WebSocketHttpHeaders(), authHeaders(authorization),
                        new StompSessionHandlerAdapter() { })
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private BlockingQueue<Map<String, Object>> subscribe(StompSession session, String channel) {
        // 구독 시도 창(600ms)이 테스트의 연속 구독을 막지 않게 한다 — 그 상한 자체는 전용 회귀가 본다.
        redis.delete(RedisKeys.emoteSubscribeAttempt(focusing));
        redis.delete(RedisKeys.emoteSubscribeAttempt(resting));
        redis.delete(RedisKeys.emoteSubscribeAttempt(visitor));
        BlockingQueue<Map<String, Object>> queue = new LinkedBlockingQueue<>();
        session.subscribe("/topic/islands/" + island + "/" + channel, new StompFrameHandler() {
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

    private BlockingQueue<SendFailureResponse> subscribeToErrors(StompSession session) {
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

    /** 도착하면 안 되는 프레임을 위한 자리. 받으면 테스트는 어차피 다른 단언에서 깨진다. */
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

    private static StompHeaders authHeaders(String authorization) {
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", authorization);
        return connectHeaders;
    }

    /** userId 당 한 번만 만든다 — 매번 만들면 exp 가 달라져 문자열이 바뀌고 스텁이 어긋난다. */
    private String bearerOf(UUID userId) {
        return bearers.computeIfAbsent(userId, id -> bearerExpiringAt(id, Instant.now().plus(Duration.ofHours(1))));
    }

    private String bearerExpiringAt(UUID userId, Instant expiry) {
        return "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .expiration(java.util.Date.from(expiry))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }
}

package com.oneorthree.realtime;

import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.event.InboundEventService;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.dto.ChatMessageResponse;
import com.oneorthree.realtime.message.dto.SendMessageRequest;
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
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
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
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * 실제 소켓으로 보는 받는 사람 기준 차단 (GROMO-2182).
 *
 * <p>완료 조건 그대로다 — <b>차단 사건이 도착한 뒤 차단 대상이 보낸 채팅 MESSAGE 가 차단자 STOMP 세션에 0건</b>.
 * 차단 전에 한 번 받게 해 캐시를 «차단 없음»으로 데워 둔다. 그래야 세대가 옛 캐시를 버리는지가 드러난다 —
 * TTL(120초)은 이 테스트 안에서 만료되지 않으므로 통과는 오직 세대 덕분이다.
 *
 * <p>「0건」은 «기다려도 안 왔다»로는 증명되지 않는다(느린 러너에서 늦게 올 수 있다). 그래서 차단 대상의 말을
 * 보낸 <b>다음</b> 차단자 자신이 표지 말을 보내고, 같은 토픽의 순서상 표지가 도착한 시점까지 그 말이 없음을 본다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "realtime.blocks.filter-enabled=true")
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ChatBlockFilterIntegrationTest {

    private static final long TIMEOUT_SECONDS = 15;

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private InboundEventService inboundEventService;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private GroupClient groupClient;

    @MockitoBean
    private BlockClient blockClient;

    private WebSocketStompClient stompClient;
    private UUID island;
    private UUID blocker;
    private UUID target;
    private String blockerBearer;
    private String targetBearer;

    @BeforeEach
    void setUp() {
        island = UUID.randomUUID();
        blocker = UUID.randomUUID();
        target = UUID.randomUUID();
        blockerBearer = bearer(blocker);
        targetBearer = bearer(target);
        given(groupClient.fetchMyGroupIds(blockerBearer)).willReturn(GroupClient.Membership.of(Set.of(island)));
        given(groupClient.fetchMyGroupIds(targetBearer)).willReturn(GroupClient.Membership.of(Set.of(island)));
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new JacksonJsonMessageConverter());
    }

    @AfterEach
    void tearDown() {
        redis.delete(List.of(RedisKeys.memberCache(blocker), RedisKeys.memberCache(target),
                RedisKeys.blockCache(blocker), RedisKeys.blockGeneration(blocker)));
        stompClient.stop();
    }

    @Test
    @DisplayName("차단 사건 뒤 차단 대상의 채팅은 차단자 세션에 0건이고, 차단 대상 본인과 차단자 자신의 말은 그대로 간다")
    void blockedSendersChatNeverReachesTheBlocker() throws Exception {
        given(blockClient.fetchBlockedIds(blocker)).willReturn(Set.of());
        StompSession blockerSession = connect(blockerBearer);
        BlockingQueue<ChatMessageResponse> blockerInbox = subscribe(blockerSession);
        StompSession targetSession = connect(targetBearer);
        BlockingQueue<ChatMessageResponse> targetInbox = subscribe(targetSession);

        // 차단 전 — 받는다. 이 조회로 캐시가 «차단 없음»(세대 0)으로 데워진다.
        UUID before = UUID.randomUUID();
        assertThat(sendUntilSeen(targetSession, targetInbox, before, blockerInbox)).isTrue();

        // Data 가 차단을 커밋하고 outbox 사건을 보낸다.
        given(blockClient.fetchBlockedIds(blocker)).willReturn(Set.of(target));
        inboundEventService.accept(objectMapper.readTree(blocksUpdated(blocker, target)));

        UUID after = UUID.randomUUID();
        targetSession.send("/app/groups/" + island + "/send", new SendMessageRequest("차단 뒤", after));
        // 보낸 사람 본인은 자기 말을 받는다 — 방송은 됐다.
        assertThat(awaitMessage(targetInbox, after)).isTrue();

        UUID marker = UUID.randomUUID();
        blockerSession.send("/app/groups/" + island + "/send", new SendMessageRequest("표지", marker));
        List<UUID> seen = drainUntil(blockerInbox, marker);
        assertThat(seen).as("차단자 자신의 표지 말은 도착해야 한다").contains(marker);
        assertThat(seen).as("차단 대상의 말은 차단자 세션에 0건").doesNotContain(after);
        // 차단 대상은 차단자의 말을 계속 받는다 — 차단은 차단한 쪽 화면의 필터다.
        assertThat(awaitMessage(targetInbox, marker)).isTrue();
    }

    @Test
    @DisplayName("차단 조회가 실패하면 그 프레임을 보내지 않는다(fail-closed) — 본인 말은 조회 없이 간다")
    void lookupFailureDropsOthersChat() throws Exception {
        given(blockClient.fetchBlockedIds(blocker)).willThrow(new UpstreamUnavailableException());
        StompSession blockerSession = connect(blockerBearer);
        BlockingQueue<ChatMessageResponse> blockerInbox = subscribe(blockerSession);
        StompSession targetSession = connect(targetBearer);
        BlockingQueue<ChatMessageResponse> targetInbox = subscribe(targetSession);
        given(blockClient.fetchBlockedIds(target)).willReturn(Set.of());

        UUID fromTarget = UUID.randomUUID();
        // 구독 등록을 target 쪽에서 관측한다 — blocker 쪽은 판정 불가라 받을 수 없다.
        assertThat(sendUntilSeen(targetSession, targetInbox, fromTarget, null)).isTrue();

        UUID marker = UUID.randomUUID();
        blockerSession.send("/app/groups/" + island + "/send", new SendMessageRequest("표지", marker));
        List<UUID> seen = drainUntil(blockerInbox, marker);
        assertThat(seen).contains(marker);
        assertThat(seen).doesNotContain(fromTarget);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /**
     * 구독이 브로커에 등록될 때까지 버리는 말을 보내고, 등록이 관측되면 본 말을 보낸다.
     *
     * @param alsoSeenBy {@code null} 이 아니면 그 큐에도 본 말이 도착해야 참이다
     */
    private boolean sendUntilSeen(StompSession session, BlockingQueue<ChatMessageResponse> own, UUID id,
            BlockingQueue<ChatMessageResponse> alsoSeenBy) throws InterruptedException {
        boolean registered = false;
        for (int attempt = 0; attempt < 20 && !registered; attempt++) {
            session.send("/app/groups/" + island + "/send",
                    new SendMessageRequest("구독 등록 확인용", UUID.randomUUID()));
            registered = own.poll(500, TimeUnit.MILLISECONDS) != null;
        }
        if (!registered) {
            return false;
        }
        if (alsoSeenBy != null) {
            // 상대 구독도 등록됐는지 같은 방식으로 본다 — 상대 큐에 무엇이든 도착하면 살아 있다.
            boolean other = false;
            for (int attempt = 0; attempt < 20 && !other; attempt++) {
                session.send("/app/groups/" + island + "/send",
                        new SendMessageRequest("상대 구독 확인용", UUID.randomUUID()));
                other = alsoSeenBy.poll(500, TimeUnit.MILLISECONDS) != null;
            }
            if (!other) {
                return false;
            }
        }
        session.send("/app/groups/" + island + "/send", new SendMessageRequest("본 말", id));
        boolean ownSeen = awaitMessage(own, id);
        return alsoSeenBy == null ? ownSeen : ownSeen && awaitMessage(alsoSeenBy, id);
    }

    private static boolean awaitMessage(BlockingQueue<ChatMessageResponse> queue, UUID clientMessageId)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            ChatMessageResponse received = queue.poll(200, TimeUnit.MILLISECONDS);
            if (received != null && clientMessageId.equals(received.clientMessageId())) {
                return true;
            }
        }
        return false;
    }

    /** 표지가 올 때까지 받은 모든 {@code clientMessageId} — 표지 뒤로 조금 더 기다려 늦게 오는 것도 담는다. */
    private static List<UUID> drainUntil(BlockingQueue<ChatMessageResponse> queue, UUID marker)
            throws InterruptedException {
        List<UUID> seen = new ArrayList<>();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline && !seen.contains(marker)) {
            ChatMessageResponse received = queue.poll(200, TimeUnit.MILLISECONDS);
            if (received != null) {
                seen.add(received.clientMessageId());
            }
        }
        ChatMessageResponse late;
        while ((late = queue.poll(500, TimeUnit.MILLISECONDS)) != null) {
            seen.add(late.clientMessageId());
        }
        return seen;
    }

    private StompSession connect(String bearer) throws Exception {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", bearer);
        return stompClient.connectAsync("ws://localhost:" + port + "/ws/chat", new WebSocketHttpHeaders(), headers,
                new StompSessionHandlerAdapter() { }).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private BlockingQueue<ChatMessageResponse> subscribe(StompSession session) {
        BlockingQueue<ChatMessageResponse> queue = new LinkedBlockingQueue<>();
        session.subscribe("/topic/groups/" + island, new StompFrameHandler() {
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

    private String bearer(UUID userId) {
        return "Bearer " + Jwts.builder()
                .subject(userId.toString())
                .claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .compact();
    }

    /** Data {@code UserBlockEvents} 가 적는 10필드 정본 봉투. */
    private static String blocksUpdated(UUID blockerId, UUID blockedId) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,\"type\":\"user.blocks.updated\","
                + "\"occurredAt\":\"2026-10-01T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + blockerId + "\","
                + "\"locale\":null,\"subjectId\":\"" + blockerId + "\",\"version\":1,"
                + "\"params\":{\"blockerUserId\":\"" + blockerId + "\",\"blockedUserId\":\"" + blockedId + "\","
                + "\"changeKind\":\"BLOCKED\"}}";
    }
}

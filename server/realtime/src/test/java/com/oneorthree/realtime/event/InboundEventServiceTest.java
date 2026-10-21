package com.oneorthree.realtime.event;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.config.OutboundAuthzCache;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.membership.CurrentMembershipDecisionCache;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.membership.MembershipService;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.repository.ChatReadCursorRepository;
import com.oneorthree.realtime.message.service.ChatUserFence;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 두 입구 하나의 처리기 (GROMO-1954, 2026-09-19 R-1) — HTTP 와 Kafka 가 같은 {@link InboundEventService} 로
 * 들어가 {@code eventId} 로 한 번만 적용되는지, 실제 PostgreSQL(V3 {@code inbound_events})로 본다.
 *
 * <p>Kafka 입구는 브로커 없이 리스너 메서드를 직접 부른다 — 검증 대상은 「같은 처리기로 들어가 한 번만
 * 적용된다」이고, 브로커 배선(DLT·ack)은 알림 서버 {@code KafkaInbound} 와 같은 모양이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class InboundEventServiceTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ChatReadCursorRepository chatReadCursorRepository;

    @Autowired
    private InboundEventService inboundEventService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private io.micrometer.core.instrument.MeterRegistry meterRegistry;

    @MockitoSpyBean
    private ChatUserFence chatUserFence;

    @MockitoSpyBean
    private EventRouter eventRouter;

    @MockitoSpyBean
    private MovementSubscriptionListener movementSubscriptions;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RealtimeSessionRegistry sessionRegistry;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Value("${realtime.internal.data-service-token}")
    private String dataToken;

    /** legacy 경로의 멤버십 상류 — 이 테스트는 호출하지 않는다. */
    @MockitoBean
    private GroupClient groupClient;

    @Test
    @DisplayName("같은 eventId 가 HTTP → Kafka → HTTP 로 세 번 와도 탈퇴 적용은 한 번이고 커서는 지워진다")
    void sameEventIdAcrossBothEntrancesAppliesOnce() throws Exception {
        UUID user = UUID.randomUUID();
        chatReadCursorRepository.upsertIfNewer(UUID.randomUUID(), UUID.randomUUID(), user, UUID.randomUUID(),
                Instant.now());
        String envelope = withdrawn(user, 4);

        http(envelope);
        new KafkaEventInbound(inboundEventService, objectMapper).receive(envelope);
        http(envelope);

        verify(chatUserFence, times(1)).withdraw(user, 4L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM chat_read_cursors WHERE user_id = ?", Long.class, user))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE event_id = ?", Long.class,
                "user.withdrawn:" + user)).isEqualTo(1L);
    }

    @Test
    @DisplayName("적용이 실패하면 수신 기록도 롤백된다 — 재전달이 다시 적용한다")
    void failedApplyDoesNotMarkTheEventAsSeen() throws Exception {
        UUID user = UUID.randomUUID();
        String broken = withdrawn(user, 1).replace("\"authGeneration\":1", "\"authGeneration\":\"x\"");

        mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(broken)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken)).andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE event_id = ?", Long.class,
                "user.withdrawn:" + user)).isZero();

        http(withdrawn(user, 1));
        verify(chatUserFence, times(1)).withdraw(user, 1L);
    }

    @Test
    @DisplayName("앱 사건은 10필드 정본·옛 7필드 모양 모두 200 으로 받아 기록만 한다 — 앱 전달·탈퇴 적용은 없다")
    void appEventsAreAcceptedInBothShapesWithoutDelivery() throws Exception {
        UUID island = UUID.randomUUID();
        String canonical = "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"island.updated\",\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + UUID.randomUUID() + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":3,\"params\":{\"islandId\":\"" + island + "\"}}";
        String legacySevenField = "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"member.appearance.updated\",\"islandId\":\"" + island + "\",\"aggregateVersion\":2,"
                + "\"occurredAt\":\"2026-09-19T00:00:00Z\",\"payload\":{\"version\":2}}";

        http(canonical);
        http(legacySevenField);

        verify(chatUserFence, never()).withdraw(any(), anyLong());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE type IN (?, ?)", Long.class,
                "island.updated", "member.appearance.updated")).isGreaterThanOrEqualTo(2L);
    }

    @Test
    @DisplayName("강퇴·탈퇴 사건이 오면 그 유저의 멤버십 캐시만 즉시 지운다(GROMO-2140) — TTL 을 기다리지 않는다")
    void memberRemovedEvictsOnlyThatUsersCache() throws Exception {
        UUID island = UUID.randomUUID();
        UUID kicked = UUID.randomUUID();
        UUID untouched = UUID.randomUUID();
        redis.opsForValue().set(RedisKeys.memberCache(kicked), island.toString(), Duration.ofSeconds(120));
        redis.opsForValue().set(RedisKeys.memberCache(untouched), island.toString(), Duration.ofSeconds(120));

        http(membersUpdated(island, "MEMBER_REMOVED", kicked, 5));

        assertThat(redis.hasKey(RedisKeys.memberCache(kicked))).isFalse();
        assertThat(redis.hasKey(RedisKeys.memberCache(untouched))).isTrue();
        // island.members.updated 는 아직 전달 어댑터가 없다 — 무효화는 STOMP 전달과 무관한 부수 효과다.
        verify(eventRouter, never()).route(any(), any());
    }

    @Test
    @DisplayName("memberUserId 가 없는 옛 Data 사건은 조용히 건너뛴다 — TTL 이 그대로 백스톱이다")
    void missingMemberUserIdIsANoOp() throws Exception {
        UUID island = UUID.randomUUID();
        UUID member = UUID.randomUUID();
        redis.opsForValue().set(RedisKeys.memberCache(member), island.toString(), Duration.ofSeconds(120));
        String legacyShape = "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"island.members.updated\",\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + UUID.randomUUID() + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":5,\"params\":{\"changeKind\":\"MEMBER_REMOVED\",\"islandId\":\"" + island + "\"}}";

        http(legacyShape);

        assertThat(redis.hasKey(RedisKeys.memberCache(member))).isTrue();
    }

    @Test
    @DisplayName("방장 위임(HOST_TRANSFER)은 소속이 안 바뀐다 — memberUserId 가 있어도 무효화하지 않는다")
    void hostTransferNeverEvicts() throws Exception {
        UUID island = UUID.randomUUID();
        UUID previousHost = UUID.randomUUID();
        UUID newHost = UUID.randomUUID();
        redis.opsForValue().set(RedisKeys.memberCache(previousHost), island.toString(), Duration.ofSeconds(120));
        redis.opsForValue().set(RedisKeys.memberCache(newHost), island.toString(), Duration.ofSeconds(120));
        String hostTransfer = "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"island.members.updated\",\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + previousHost + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":6,\"params\":{\"changeKind\":\"HOST_TRANSFER\",\"islandId\":\"" + island + "\","
                + "\"previousHostUserId\":\"" + previousHost + "\",\"hostUserId\":\"" + newHost + "\"}}";

        http(hostTransfer);

        assertThat(redis.hasKey(RedisKeys.memberCache(previousHost))).isTrue();
        assertThat(redis.hasKey(RedisKeys.memberCache(newHost))).isTrue();
    }

    @Test
    @DisplayName("이동 방 재검사는 MEMBER_REMOVED 만, 그 섬·그 사용자로, 커밋 뒤에 건다 — MEMBER_ADDED 는 건드리지 않는다")
    void movementRecheckRunsOnlyForRemovalAfterCommit() throws Exception {
        UUID island = UUID.randomUUID();
        UUID joined = UUID.randomUUID();
        UUID kicked = UUID.randomUUID();

        http(membersUpdated(island, "MEMBER_ADDED", joined, 1));
        verify(movementSubscriptions, never()).recheckMembership(any(), any());

        http(membersUpdated(island, "MEMBER_REMOVED", kicked, 2));
        verify(movementSubscriptions).recheckMembership(island, kicked);
    }

    @Test
    @DisplayName("사건 수신이 롤백되면 이동 방 재검사를 부르지 않는다 — relay 가 다시 보낼 사건으로 사람을 내보내지 않는다")
    void rolledBackEventNeverTriggersTheMovementRecheck() {
        UUID island = UUID.randomUUID();
        UUID kicked = UUID.randomUUID();
        JsonNode event = objectMapper.readTree(membersUpdated(island, "MEMBER_REMOVED", kicked, 5));

        // 수신(같은 트랜잭션에 합류) 뒤 그 트랜잭션이 실패한 경우 — afterCommit 이 오지 않아야 한다.
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            inboundEventService.accept(event);
            status.setRollbackOnly();
        });

        verify(movementSubscriptions, never()).recheckMembership(any(), any());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE event_id = ?", Long.class,
                event.get("eventId").stringValue())).isZero();
    }

    @Test
    @DisplayName("트랜잭션 밖에서 불리면 이동 방 재검사를 곧바로 건다 — 기다릴 커밋이 없다")
    void movementRecheckRunsImmediatelyWithoutATransaction() {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        MovementSubscriptionListener listener = mock(MovementSubscriptionListener.class);
        InboundEventService plain = new InboundEventService(plainJdbc, mock(ChatUserFence.class),
                mock(EventRouter.class), mock(MembershipService.class), mock(BlockedUsers.class), listener,
                mock(com.oneorthree.realtime.sea.SeaRooms.class),
                mock(com.oneorthree.realtime.membership.CurrentMembershipDecisionCache.class),
                mock(com.oneorthree.realtime.config.OutboundAuthzCache.class), mock(RealtimeSessionRegistry.class), mock(JwtValidator.class), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        UUID island = UUID.randomUUID();
        UUID kicked = UUID.randomUUID();

        assertThat(plain.accept(objectMapper.readTree(membersUpdated(island, "MEMBER_REMOVED", kicked, 4)))).isTrue();

        verify(listener).recheckMembership(island, kicked);
    }

    @Test
    @DisplayName("강퇴 사건의 멤버십 캐시 삭제가 실패하면 그 (섬, 사용자)의 이동 구독 판정이 캐시를 건너뛰게 표시한다 — 성공하면 표시하지 않는다")
    void failedCacheEvictionMarksTheMembershipStaleForMovement() {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        MovementSubscriptionListener listener = mock(MovementSubscriptionListener.class);
        MembershipService membership = mock(MembershipService.class);
        InboundEventService plain = new InboundEventService(plainJdbc, mock(ChatUserFence.class),
                mock(EventRouter.class), membership, mock(BlockedUsers.class), listener,
                mock(com.oneorthree.realtime.sea.SeaRooms.class),
                mock(com.oneorthree.realtime.membership.CurrentMembershipDecisionCache.class),
                mock(com.oneorthree.realtime.config.OutboundAuthzCache.class), mock(RealtimeSessionRegistry.class), mock(JwtValidator.class), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        UUID island = UUID.randomUUID();
        UUID kicked = UUID.randomUUID();
        UUID evicted = UUID.randomUUID();
        given(membership.evict(kicked)).willReturn(false); // Redis 실패 — 옛 「멤버」 답이 남는다
        given(membership.evict(evicted)).willReturn(true);

        plain.accept(objectMapper.readTree(membersUpdated(island, "MEMBER_REMOVED", kicked, 4)));
        plain.accept(objectMapper.readTree(membersUpdated(island, "MEMBER_REMOVED", evicted, 5)));

        verify(listener).markMembershipCacheStale(island, kicked);
        verify(listener, never()).markMembershipCacheStale(island, evicted);
    }

    @Test
    @DisplayName("강퇴(MEMBER_REMOVED)·탈퇴(user.withdrawn) 사건은 ON 모드 허용 결정 캐시를 그 사용자 기준으로 지운다")
    void membershipAndWithdrawEventsEvictCurrentDecisionCache() throws Exception {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        var decisions = mock(com.oneorthree.realtime.membership.CurrentMembershipDecisionCache.class);
        var outbound = mock(com.oneorthree.realtime.config.OutboundAuthzCache.class);
        InboundEventService plain = new InboundEventService(plainJdbc, mock(ChatUserFence.class),
                mock(EventRouter.class), mock(MembershipService.class), mock(BlockedUsers.class),
                mock(MovementSubscriptionListener.class), mock(com.oneorthree.realtime.sea.SeaRooms.class), decisions,
                outbound, mock(RealtimeSessionRegistry.class), mock(JwtValidator.class), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        UUID kicked = UUID.randomUUID();
        UUID gone = UUID.randomUUID();

        plain.accept(objectMapper.readTree(membersUpdated(UUID.randomUUID(), "MEMBER_REMOVED", kicked, 4)));
        plain.accept(objectMapper.readTree(withdrawn(gone, 2)));

        verify(decisions).evictUser(kicked);
        verify(decisions).evictUser(gone);

        // 옛 Data — memberUserId 없는 MEMBER_REMOVED 는 섬 단위로 지운다
        UUID island = UUID.randomUUID();
        plain.accept(objectMapper.readTree(membersUpdated(island, "MEMBER_REMOVED", null, 9)
                .replace(",\"memberUserId\":\"null\"", "")));
        verify(decisions).evictIsland(island);
        verify(outbound).evictIsland(island); // 전달 직전 허용도 섬 단위로(GROMO-2340)

        // 형식 불량 memberUserId — 사용자를 모르는 것과 같아 섬 단위로 지운다
        UUID island2 = UUID.randomUUID();
        plain.accept(objectMapper.readTree(membersUpdated(island2, "MEMBER_REMOVED", null, 10)
                .replace("\"memberUserId\":\"null\"", "\"memberUserId\":\"not-a-uuid\"")));
        verify(decisions).evictIsland(island2);
        verify(outbound).evictIsland(island2);
    }

    @Test
    @DisplayName("이동 방 재검사가 던져도 사건 수신은 그대로 커밋된다 — relay 가 같은 사건을 되풀이하지 않는다")
    void movementRecheckFailureNeverRollsBackTheEvent() throws Exception {
        UUID island = UUID.randomUUID();
        UUID kicked = UUID.randomUUID();
        willThrow(new IllegalStateException("재검사 실패")).given(movementSubscriptions)
                .recheckMembership(island, kicked);
        String event = membersUpdated(island, "MEMBER_REMOVED", kicked, 3);

        http(event);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE event_id = ?", Long.class,
                objectMapper.readTree(event).get("eventId").stringValue())).isEqualTo(1L);
    }

    @Test
    @DisplayName("멤버십·차단·탈퇴 사건은 원 캐시를 고친 «뒤» 전달 직전 인가 캐시에서 그 사용자를 지운다(GROMO-2340)")
    void outboundAuthzCacheIsEvictedAfterTheSourceCache() throws Exception {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        MembershipService membership = mock(MembershipService.class);
        BlockedUsers blocks = mock(BlockedUsers.class);
        ChatUserFence fence = mock(ChatUserFence.class);
        com.oneorthree.realtime.config.OutboundAuthzCache cache =
                mock(com.oneorthree.realtime.config.OutboundAuthzCache.class);
        var decisions = mock(com.oneorthree.realtime.membership.CurrentMembershipDecisionCache.class);
        InboundEventService plain = new InboundEventService(plainJdbc, fence, mock(EventRouter.class), membership,
                blocks, mock(MovementSubscriptionListener.class), mock(com.oneorthree.realtime.sea.SeaRooms.class),
                decisions, cache, mock(RealtimeSessionRegistry.class), mock(JwtValidator.class), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        UUID kicked = UUID.randomUUID();
        UUID blocker = UUID.randomUUID();
        UUID leaver = UUID.randomUUID();
        given(membership.evict(kicked)).willReturn(true);

        plain.accept(objectMapper.readTree(membersUpdated(UUID.randomUUID(), "MEMBER_REMOVED", kicked, 4)));
        plain.accept(objectMapper.readTree(blocksUpdated(UUID.randomUUID().toString(),
                "\"blockerUserId\":\"" + blocker + "\"")));
        plain.accept(objectMapper.readTree(withdrawn(leaver, 1)));

        // 순서: ON 모드 허용 결정(2342) → 원 캐시·펜스 → 전달 직전 허용(2340)
        var order = org.mockito.Mockito.inOrder(decisions, membership, blocks, fence, cache);
        order.verify(decisions).evictUser(kicked);
        order.verify(membership).evict(kicked);
        order.verify(cache).evictUser(kicked);
        order.verify(blocks).advanceGeneration(blocker);
        order.verify(cache).evictUser(blocker);
        order.verify(decisions).evictUser(leaver);
        order.verify(fence).withdraw(leaver, 1);
        order.verify(cache).evictUser(leaver);
    }

    /** Data outbox 정본 봉투 — {@code IslandMembershipEvents#changed} 가 내보내는 params 모양 그대로다. */
    private static String membersUpdated(UUID island, String changeKind, UUID memberUserId, long version) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"island.members.updated\",\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + UUID.randomUUID() + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":" + version + ",\"params\":{\"changeKind\":\"" + changeKind + "\",\"islandId\":\""
                + island + "\",\"memberUserId\":\"" + memberUserId + "\"}}";
    }

    @Test
    @DisplayName("user.blocks.updated 는 차단자의 차단 세대를 한 번만 올리고, blockerUserId 가 없으면 200 으로 건너뛴다")
    void blocksUpdatedAdvancesTheBlockersGenerationOnce() throws Exception {
        UUID blocker = UUID.randomUUID();
        String event = blocksUpdated(UUID.randomUUID().toString(), "\"blockerUserId\":\"" + blocker + "\"");

        http(event);
        http(event);
        new KafkaEventInbound(inboundEventService, objectMapper).receive(event);

        assertThat(redis.opsForValue().get(RedisKeys.blockGeneration(blocker))).isEqualTo("1");
        // 세대 키는 수명 없이 남는다 — 만료되면 번호가 재사용돼 옛 캐시와 충돌한다.
        assertThat(redis.getExpire(RedisKeys.blockGeneration(blocker))).isEqualTo(-1L);

        UUID other = UUID.randomUUID();
        http(blocksUpdated(UUID.randomUUID().toString(), "\"blockedUserId\":\"" + other + "\""));
        http(blocksUpdated(UUID.randomUUID().toString(), "\"blockerUserId\":\"not-a-uuid\""));
        assertThat(redis.hasKey(RedisKeys.blockGeneration(other))).isFalse();
        redis.delete(RedisKeys.blockGeneration(blocker));
    }

    /** Data {@code UserBlockEvents} 가 적는 10필드 정본 봉투. */
    private static String blocksUpdated(String eventId, String params) {
        UUID user = UUID.randomUUID();
        return "{\"eventId\":\"" + eventId + "\",\"schemaVersion\":1,\"type\":\"user.blocks.updated\","
                + "\"occurredAt\":\"2026-10-01T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":1,\"params\":{" + params + "}}";
    }

    @Test
    @DisplayName("계약 밖 type·eventId 없는 봉투는 400 — 조용히 삼키지 않는다")
    void rejectsUnknownTypesAndMissingEventId() throws Exception {
        for (String body : new String[] {
                "{\"eventId\":\"e-" + UUID.randomUUID() + "\",\"type\":\"user.updated\"}",
                "{\"type\":\"island.updated\"}",
                "[]"}) {
            mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken)).andExpect(status().isBadRequest());
        }
    }

    @Test
    @DisplayName("sea.member.updated 는 200 — 바다 밖 사용자는 해시를 만들지 않고, 불량 params 도 200 이다(USER 축 보호)")
    void seaMemberUpdatedIsAcceptedEvenWhenMalformedOrOutsideTheSea() throws Exception {
        UUID user = UUID.randomUUID();
        for (String params : new String[] {
                "\"status\":\"ended\",\"sessionId\":null,\"serverNow\":\"2026-10-17T00:00:00Z\"",
                "\"status\":\"teleported\"",
                "\"status\":7",
                ""}) {
            http("{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,\"type\":\"sea.member.updated\","
                    + "\"occurredAt\":\"2026-10-17T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                    + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":1,\"params\":{" + params + "}}");
        }
        assertThat(redis.hasKey(RedisKeys.seaUser(user))).isFalse();
    }

    @Test
    @DisplayName("island.member.arrived 는 섬 events 로 전달한다 — 허용 필드만 싣고 aggregateVersion 은 봉투 version 이다(GROMO-2302)")
    void memberArrivedIsDeliveredWithProjectedFieldsOnly() throws Exception {
        UUID island = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        http(arrived(island, island, user, ",\"secret\":\"x\",\"version\":99"));

        org.mockito.ArgumentCaptor<RealtimeEventEnvelope> event =
                org.mockito.ArgumentCaptor.forClass(RealtimeEventEnvelope.class);
        verify(eventRouter).route(event.capture(), ArgumentMatchers.eq(new RealtimeAudience.IslandAudience(island)));
        assertThat(event.getValue().type()).isEqualTo(RealtimeEventType.ISLAND_MEMBER_ARRIVED);
        assertThat(event.getValue().islandId()).isEqualTo(island);
        assertThat(event.getValue().aggregateVersion()).isEqualTo(5L);
        JsonNode payload = event.getValue().payload();
        assertThat(payload.propertyNames()).containsExactlyInAnyOrder("islandId", "userId", "name", "catColor",
                "arrivedAt");
        assertThat(payload.get("name").stringValue()).isEqualTo("도착냥");
        assertThat(payload.get("catColor").isNull()).isTrue();
    }

    @Test
    @DisplayName("island.member.arrived 의 payload 섬이 봉투 섬과 다르면 200 으로 받고 전달하지 않는다(축 보호)")
    void memberArrivedForAnotherIslandIsAcceptedButNotDelivered() throws Exception {
        UUID island = UUID.randomUUID();
        http(arrived(island, UUID.randomUUID(), UUID.randomUUID(), ""));

        verify(eventRouter, never()).route(any(), ArgumentMatchers.eq(new RealtimeAudience.IslandAudience(island)));
    }

    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256";
    private static final CloseStatus REVOKED = CloseStatus.POLICY_VIOLATION.withReason("SESSION_REVOKED");

    @Test
    @DisplayName("auth.session.revoked — 폐기된 sid 의 STOMP 세션만 SESSION_REVOKED 로 닫고 허용 결정을 지운다, 같은 사용자의 다른 sid 세션은 산다")
    void sessionRevokedClosesOnlyThatSid() throws Exception {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        var decisions = mock(CurrentMembershipDecisionCache.class);
        var outbound = mock(OutboundAuthzCache.class);
        var registry = new RealtimeSessionRegistry();
        var meters = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        ChatUserFence fence = new ChatUserFence(null, null, null, java.time.Clock.systemUTC(), redis, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        InboundEventService plain = new InboundEventService(plainJdbc, fence,
                mock(EventRouter.class), mock(MembershipService.class), mock(BlockedUsers.class),
                mock(MovementSubscriptionListener.class), mock(com.oneorthree.realtime.sea.SeaRooms.class), decisions,
                outbound, registry, new JwtValidator(SECRET), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), meters);
        UUID user = UUID.randomUUID();
        UUID revokedSid = UUID.randomUUID();
        WebSocketSession revoked = connect(registry, "stomp-revoked", user, revokedSid, SECRET);
        WebSocketSession other = connect(registry, "stomp-other", user, UUID.randomUUID(), SECRET);
        WebSocketSession stranger = connect(registry, "stomp-stranger", UUID.randomUUID(), revokedSid, SECRET);

        assertThat(plain.accept(objectMapper.readTree(sessionRevoked(user, revokedSid.toString())))).isTrue();

        verify(revoked).close(REVOKED);
        verify(outbound).evictSession("stomp-revoked");
        verify(decisions).evictUser(user);
        verify(other, never()).close(any(CloseStatus.class));
        verify(stranger, never()).close(any(CloseStatus.class));
        verify(outbound, never()).evictSession("stomp-other");
        // 폐기 펜스 — 같은 sid 의 재연결은 막고 다른 sid 는 통과시킨다(StompAuthChannelInterceptorTest 가 CONNECT 거절을 본다)
        assertThat(fence.isRevoked(revokedSid)).isTrue();
        assertThat(fence.isRevoked(UUID.randomUUID())).isFalse();
        assertThat(meters.counter("realtime.session.revoked.close", "result", "closed").count()).isEqualTo(1.0);
    }

    @Test
    @DisplayName("auth.session.revoked — 두 번 닫아도 실패하고 소켓이 열려 있으면 던져 수신 트랜잭션을 롤백한다, 이미 끊겼으면 정상이다")
    void sessionRevokedCloseFailureRollsBackUnlessAlreadyGone() throws Exception {
        UUID user = UUID.randomUUID();
        UUID sid = UUID.randomUUID();
        UUID goneSid = UUID.randomUUID();
        WebSocketSession stuck = connect(sessionRegistry, "stomp-stuck-" + sid, user, sid, jwtSecret);
        org.mockito.Mockito.doThrow(new java.io.IOException("close 실패")).when(stuck).close(any(CloseStatus.class));
        String event = sessionRevoked(user, sid.toString());
        double failedBefore = closeCount("failed");
        double closedBefore = closeCount("closed");

        // 던지면 @Transactional accept 가 롤백돼 inbound_events 에 남지 않고, HTTP 는 5xx 로 나가 relay 가 다시 보낸다.
        assertThatThrownBy(() -> inboundEventService.accept(objectMapper.readTree(event)))
                .isInstanceOf(IllegalStateException.class);
        verify(stuck, times(2)).close(any(CloseStatus.class));
        String eventId = objectMapper.readTree(event).get("eventId").stringValue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inbound_events WHERE event_id = ?", Integer.class,
                eventId)).isZero();
        sessionRegistry.closed("stomp-stuck-" + sid);

        // close 가 false 여도 소켓이 이미 레지스트리에서 빠졌으면(끊김) 성공이다.
        WebSocketSession gone = connect(sessionRegistry, "stomp-gone-" + goneSid, user, goneSid, jwtSecret);
        org.mockito.Mockito.doAnswer(call -> {
            sessionRegistry.closed("stomp-gone-" + goneSid);
            throw new java.io.IOException("이미 끊김");
        }).when(gone).close(any(CloseStatus.class));
        http(sessionRevoked(user, goneSid.toString()));
        sessionRegistry.closed("stomp-gone-" + goneSid);
        assertThat(closeCount("failed") - failedBefore).isEqualTo(1.0);
        // 첫 시도가 실패하고 끊긴 뒤 두 번째 시도가 성공으로 보는 경우는 closed 로 센다.
        assertThat(closeCount("closed") - closedBefore).isEqualTo(1.0);
    }

    private double closeCount(String result) {
        return meterRegistry.counter("realtime.session.revoked.close", "result", result).count();
    }

    @Test
    @DisplayName("auth.session.revoked — 폐기 펜스 Redis TTL 은 payload accessTokenExpiresAt + 60 s 다 (GROMO-2386)")
    void sessionRevokedUsesPayloadExpiryForTheFence() throws Exception {
        UUID sid = UUID.randomUUID();

        http(sessionRevoked(UUID.randomUUID(), sid.toString(), Instant.now().plusSeconds(2).toString()));

        Long ttl = redis.getExpire(RedisKeys.revokedSession(sid), java.util.concurrent.TimeUnit.MILLISECONDS);
        assertThat(ttl).isBetween(60_000L, 62_000L);
    }

    @Test
    @DisplayName("auth.session.revoked — payload 에 만료가 없으면(옛 Data) 펜스 TTL 은 30일 폴백이다 (GROMO-2386)")
    void sessionRevokedWithoutExpiryFallsBackToThirtyDays() throws Exception {
        UUID sid = UUID.randomUUID();

        http(sessionRevoked(UUID.randomUUID(), sid.toString()));

        Long ttl = redis.getExpire(RedisKeys.revokedSession(sid), java.util.concurrent.TimeUnit.MILLISECONDS);
        assertThat(ttl).isGreaterThan(java.time.Duration.ofDays(29).toMillis());
    }

    @Test
    @DisplayName("auth.session.revoked — 팬아웃 발행이 실패하면 realtime.session.revoked.fanout{failed} 를 세고 던지지 않는다 (GROMO-2386)")
    void sessionRevokedFanoutFailureIsCounted() throws Exception {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        StringRedisTemplate broken = mock(StringRedisTemplate.class);
        org.mockito.Mockito.doThrow(new IllegalStateException("redis down")).when(broken)
                .convertAndSend(anyString(), anyString());
        var meters = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        var delivery = new RealtimeEventDelivery(mock(org.springframework.messaging.simp.SimpMessagingTemplate.class),
                broken, objectMapper, java.time.Clock.systemUTC(), meters);
        InboundEventService plain = new InboundEventService(plainJdbc, mock(ChatUserFence.class),
                mock(EventRouter.class), mock(MembershipService.class), mock(BlockedUsers.class),
                mock(MovementSubscriptionListener.class), mock(com.oneorthree.realtime.sea.SeaRooms.class),
                mock(CurrentMembershipDecisionCache.class), mock(OutboundAuthzCache.class),
                new RealtimeSessionRegistry(), new JwtValidator(SECRET), java.time.Clock.systemUTC(), delivery,
                meters);

        assertThat(plain.accept(objectMapper.readTree(sessionRevoked(UUID.randomUUID(),
                UUID.randomUUID().toString())))).isTrue();

        assertThat(meters.counter("realtime.session.revoked.fanout", "result", "failed").count()).isEqualTo(1.0);
        // 선등록 — 아무 사건도 처리하기 전에 0 으로 이미 있다(새 registry 로 생성자만 거친 경우)
        var fresh = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        new RealtimeEventDelivery(mock(org.springframework.messaging.simp.SimpMessagingTemplate.class), broken,
                objectMapper, java.time.Clock.systemUTC(), fresh);
        assertThat(fresh.find("realtime.session.revoked.fanout").tag("result", "failed").counter().count())
                .isZero();
    }

    @Test
    @DisplayName("auth.session.revoked — 펜스가 세션 목록 스냅샷·종료보다 먼저 올라간다 (CONNECT 경합 창 없음)")
    void sessionRevokedRaisesTheFenceBeforeSnapshotAndClose() throws Exception {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        ChatUserFence fence = mock(ChatUserFence.class);
        var registry = org.mockito.Mockito.spy(new RealtimeSessionRegistry());
        InboundEventService plain = new InboundEventService(plainJdbc, fence, mock(EventRouter.class),
                mock(MembershipService.class), mock(BlockedUsers.class), mock(MovementSubscriptionListener.class),
                mock(com.oneorthree.realtime.sea.SeaRooms.class), mock(CurrentMembershipDecisionCache.class),
                mock(OutboundAuthzCache.class), registry, new JwtValidator(SECRET), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        UUID user = UUID.randomUUID();
        UUID sid = UUID.randomUUID();
        connect(registry, "stomp-order", user, sid, SECRET);

        plain.accept(objectMapper.readTree(sessionRevoked(user, sid.toString())));

        var order = org.mockito.Mockito.inOrder(fence, registry);
        order.verify(fence).revokeSession(org.mockito.ArgumentMatchers.eq(sid), any());
        order.verify(registry).sessionIdsOf(user);
        order.verify(registry).close("stomp-order", REVOKED);
    }

    @Test
    @DisplayName("auth.session.revoked 는 기존 팬아웃 채널로 다른 replica 에 퍼져 그 replica 가 인메모리 펜스를 올리고 자기 세션을 닫는다 — 멱등 (GROMO-2350)")
    void sessionRevokedFansOutToTheOtherReplica() throws Exception {
        java.time.Clock clock = java.time.Clock.systemUTC();
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        // replica A — 사건을 HTTP 로 받는다. 발행은 실제 직렬화 그대로 잡아 B 의 구독자에 먹인다.
        StringRedisTemplate publishRedis = mock(StringRedisTemplate.class);
        var deliveryA = new RealtimeEventDelivery(mock(org.springframework.messaging.simp.SimpMessagingTemplate.class),
                publishRedis, objectMapper, clock, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        var registryA = new RealtimeSessionRegistry();
        var fenceA = new ChatUserFence(null, null, null, clock, redis, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        InboundEventService serviceA = new InboundEventService(plainJdbc, fenceA, mock(EventRouter.class),
                mock(MembershipService.class), mock(BlockedUsers.class), mock(MovementSubscriptionListener.class),
                mock(com.oneorthree.realtime.sea.SeaRooms.class), mock(CurrentMembershipDecisionCache.class),
                mock(OutboundAuthzCache.class), registryA, new JwtValidator(SECRET), clock, deliveryA, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        // replica B — Redis 를 쓰지 않는 인메모리 펜스만 가진다(redis=null 이면 Redis 를 건드리는 순간 NPE 라 증명이 된다).
        var registryB = new RealtimeSessionRegistry();
        var fenceB = new ChatUserFence(null, null, null, clock, null, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        var outboundB = mock(OutboundAuthzCache.class);
        var deliveryB = new RealtimeEventDelivery(mock(org.springframework.messaging.simp.SimpMessagingTemplate.class),
                publishRedis, objectMapper, clock, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        InboundEventService serviceB = new InboundEventService(plainJdbc, fenceB, mock(EventRouter.class),
                mock(MembershipService.class), mock(BlockedUsers.class), mock(MovementSubscriptionListener.class),
                mock(com.oneorthree.realtime.sea.SeaRooms.class), mock(CurrentMembershipDecisionCache.class),
                outboundB, registryB, new JwtValidator(SECRET), clock, deliveryB, new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        var subscriberB = new RealtimeEventFanoutSubscriber(deliveryB, serviceB, objectMapper);

        UUID user = UUID.randomUUID();
        UUID sid = UUID.randomUUID();
        WebSocketSession onA = connect(registryA, "a-1", user, sid, SECRET);
        WebSocketSession onB = connect(registryB, "b-1", user, sid, SECRET);
        WebSocketSession otherOnB = connect(registryB, "b-2", user, UUID.randomUUID(), SECRET);

        Instant exp = Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        serviceA.accept(objectMapper.readTree(sessionRevoked(user, sid.toString(), exp.toString())));

        var payload = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(publishRedis).convertAndSend(org.mockito.ArgumentMatchers.eq(RedisKeys.EVENT_FANOUT_CHANNEL),
                payload.capture());
        verify(onA).close(REVOKED);
        // GROMO-2386 — 만료가 봉투로 실려 간다: payload 만료 + 60 s
        assertThat(Instant.parse(objectMapper.readTree(payload.getValue()).get("revokedUntil").stringValue()))
                .isEqualTo(exp.plusSeconds(60));
        org.springframework.data.redis.connection.Message wire = new org.springframework.data.redis.connection
                .DefaultMessage(RedisKeys.EVENT_FANOUT_CHANNEL.getBytes(StandardCharsets.UTF_8),
                payload.getValue().getBytes(StandardCharsets.UTF_8));
        subscriberB.onMessage(wire, null);
        subscriberB.onMessage(wire, null); // 중복 전달 — 멱등

        verify(onB, org.mockito.Mockito.atLeastOnce()).close(REVOKED);
        verify(outboundB, org.mockito.Mockito.atLeastOnce()).evictSession("b-1");
        verify(otherOnB, never()).close(any(CloseStatus.class));
        assertThat(fenceB.isRevoked(sid)).isTrue();
        assertThat(fenceB.isRevoked(UUID.randomUUID())).isFalse();
        // 자기 메아리는 건너뛴다 — 발행한 replica 의 구독자는 아무것도 하지 않는다.
        new RealtimeEventFanoutSubscriber(deliveryA, serviceA, objectMapper).onMessage(wire, null);
        verify(onA, times(1)).close(REVOKED);
    }

    @Test
    @DisplayName("섬 사건 팬아웃 봉투의 wire 에는 제어 키가 없다 — 롤링 배포 중 옛 replica 의 매퍼 설정에 기대지 않는다")
    void islandFanoutWireHasNoControlKeys() throws Exception {
        String json = objectMapper.writeValueAsString(RealtimeEventFanoutEvent.island(UUID.randomUUID(),
                "/topic/islands/x/focus", null, java.util.Set.of()));

        assertThat(json).doesNotContain("revokedUserId").doesNotContain("revokedSessionId")
                .doesNotContain("revokedUntil");
        assertThat(objectMapper.writeValueAsString(RealtimeEventFanoutEvent.sessionRevoked(UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID(), Instant.now()))).contains("revokedUserId").contains("revokedSessionId")
                .contains("revokedUntil");
    }

    @Test
    @DisplayName("구독자 — 반쪽 제어 필드(userId 만 null)나 destination 없는 섬 봉투는 전달도 폐기 처리도 없이 조용히 버린다")
    void subscriberDropsMalformedEnvelopes() throws Exception {
        var delivery = mock(RealtimeEventDelivery.class);
        given(delivery.instanceId()).willReturn(UUID.randomUUID()); // 자기 메아리 판정이 NPE 로 새지 않게
        var service = mock(InboundEventService.class);
        var subscriber = new RealtimeEventFanoutSubscriber(delivery, service, objectMapper);
        UUID origin = UUID.randomUUID();
        String halfControl = objectMapper.writeValueAsString(new RealtimeEventFanoutEvent(origin, null, null,
                java.util.Set.of(), null, UUID.randomUUID(), null));
        String islandWithoutDestination = objectMapper.writeValueAsString(new RealtimeEventFanoutEvent(origin, null,
                null, java.util.Set.of(), null, null, null));

        for (String body : new String[] {halfControl, islandWithoutDestination}) {
            subscriber.onMessage(new org.springframework.data.redis.connection.DefaultMessage(
                    RedisKeys.EVENT_FANOUT_CHANNEL.getBytes(StandardCharsets.UTF_8),
                    body.getBytes(StandardCharsets.UTF_8)), null);
        }

        verify(service, never()).applySessionRevocation(any(), any(), any());
        verify(delivery, never()).deliverLocally(any(), any(), any());
    }

    @Test
    @DisplayName("폐기 펜스의 Redis 쓰기가 실패해도 던지지 않는다 — 인메모리 펜스와 종료로 계속한다")
    void fenceRedisWriteFailureIsWarnedNotThrown() {
        StringRedisTemplate broken = mock(StringRedisTemplate.class);
        given(broken.opsForValue()).willThrow(new IllegalStateException("redis down"));
        given(broken.hasKey(anyString())).willThrow(new IllegalStateException("redis down"));
        var meters = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        var fence = new ChatUserFence(null, null, null, java.time.Clock.systemUTC(), broken, meters);
        UUID sid = UUID.randomUUID();

        fence.revokeSession(sid, java.time.Instant.now().plusSeconds(60));

        assertThat(fence.isRevoked(sid)).isTrue();
        assertThat(fence.isRevokedDurable(UUID.randomUUID())).isFalse(); // 읽기 실패는 fail-open
        assertThat(meters.counter("realtime.session.revoked.fence", "op", "write", "result", "failed").count())
                .isEqualTo(1.0);
        assertThat(meters.counter("realtime.session.revoked.fence", "op", "read", "result", "failed").count())
                .isEqualTo(1.0);
    }

    @Test
    @DisplayName("폐기 펜스는 Redis 로 내구화된다 — 새 ChatUserFence(재시작)도 CONNECT 용 조회에서 보고, TTL 이 지나면 사라진다")
    void revokedSessionFenceSurvivesARestartUntilTheTtl() throws Exception {
        java.time.Clock clock = java.time.Clock.systemUTC();
        UUID sid = UUID.randomUUID();
        new ChatUserFence(null, null, null, clock, redis, new io.micrometer.core.instrument.simple.SimpleMeterRegistry()).revokeSession(sid, clock.instant().plusMillis(800));

        ChatUserFence restarted = new ChatUserFence(null, null, null, clock, redis, new io.micrometer.core.instrument.simple.SimpleMeterRegistry()); // 인메모리 맵이 빈 새 인스턴스
        assertThat(restarted.isRevoked(sid)).isFalse(); // 프레임용 인메모리 검사는 모른다
        assertThat(restarted.isRevokedDurable(sid)).isTrue(); // CONNECT 용은 Redis 로 본다
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5))
                .untilAsserted(() -> assertThat(restarted.isRevokedDurable(sid)).isFalse());
    }

    @Test
    @DisplayName("auth.session.revoked — sessionId 누락·형식 불량이면 200 + skip, 아무 연결도 닫지 않는다")
    void sessionRevokedWithoutUsableSidIsSkipped() throws Exception {
        JdbcTemplate plainJdbc = mock(JdbcTemplate.class);
        given(plainJdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any()))
                .willReturn(1);
        var decisions = mock(CurrentMembershipDecisionCache.class);
        var registry = new RealtimeSessionRegistry();
        InboundEventService plain = new InboundEventService(plainJdbc, mock(ChatUserFence.class),
                mock(EventRouter.class), mock(MembershipService.class), mock(BlockedUsers.class),
                mock(MovementSubscriptionListener.class), mock(com.oneorthree.realtime.sea.SeaRooms.class), decisions,
                mock(OutboundAuthzCache.class), registry, new JwtValidator(SECRET), java.time.Clock.systemUTC(),
                mock(RealtimeEventDelivery.class), new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
        UUID user = UUID.randomUUID();
        WebSocketSession session = connect(registry, "stomp-1", user, UUID.randomUUID(), SECRET);

        assertThat(plain.accept(objectMapper.readTree(sessionRevoked(user, null)))).isTrue();
        assertThat(plain.accept(objectMapper.readTree(sessionRevoked(user, "not-a-uuid")))).isTrue();

        verify(session, never()).close(any(CloseStatus.class));
        verify(decisions, never()).evictUser(any());
    }

    @Test
    @DisplayName("auth.session.revoked 가 HTTP 입구로 200 이고 실제 레지스트리의 그 sid 세션을 닫는다 — 알 수 없는 type 은 여전히 400")
    void sessionRevokedOverHttpClosesTheSession() throws Exception {
        UUID user = UUID.randomUUID();
        UUID sid = UUID.randomUUID();
        WebSocketSession socket = connect(sessionRegistry, "stomp-http-" + sid, user, sid, jwtSecret);

        http(sessionRevoked(user, sid.toString()));

        verify(socket).close(REVOKED);
        sessionRegistry.closed("stomp-http-" + sid);
    }

    private WebSocketSession connect(RealtimeSessionRegistry registry, String stompId, UUID user, UUID sid,
            String secret) {
        WebSocketSession socket = mock(WebSocketSession.class);
        given(socket.getId()).willReturn(stompId);
        given(socket.isOpen()).willReturn(true);
        registry.opened(socket);
        String jwt = Jwts.builder().claims(java.util.Map.of("sub", user.toString(), "sid", sid.toString(),
                        "gen", 0L, "type", "access", "exp", new Date(System.currentTimeMillis() + 600_000)))
                .signWith(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8))).compact();
        registry.register(stompId, new ChatPrincipal(user, "Bearer " + jwt));
        return socket;
    }

    /** Data {@code AuthSessionService.appendSessionRevoked} 봉투 — {@code sessionId} 가 null 이면 params 에서 뺀다. */
    private static String sessionRevoked(UUID user, String sessionId) {
        return sessionRevoked(user, sessionId, null);
    }

    /** {@code accessTokenExpiresAt} 가 null 이면 키 자체를 싣지 않는다(옛 Data). */
    private static String sessionRevoked(UUID user, String sessionId, String accessTokenExpiresAt) {
        return "{\"eventId\":\"auth.session.revoked:" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"auth.session.revoked\",\"occurredAt\":\"2026-10-21T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + user + "\",\"locale\":null,\"subjectId\":\"" + sessionId + "\",\"version\":3,"
                + "\"params\":{" + (sessionId == null ? "" : "\"sessionId\":\"" + sessionId + "\",")
                + "\"sessionEpoch\":3,\"bootstrapNonceHash\":null,\"reason\":\"LOGOUT\""
                + (accessTokenExpiresAt == null ? "" : ",\"accessTokenExpiresAt\":\"" + accessTokenExpiresAt + "\"")
                + "}}";
    }

    /** Data {@code IslandArrivalEvents} 가 적는 봉투 모양 — {@code extra} 는 params 끝에 덧붙는다. */
    private static String arrived(UUID subject, UUID payloadIsland, UUID user, String extra) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,\"type\":\"island.member.arrived\","
                + "\"occurredAt\":\"2026-10-18T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + subject + "\",\"version\":5,\"params\":{"
                + "\"islandId\":\"" + payloadIsland + "\",\"userId\":\"" + user + "\",\"name\":\"도착냥\","
                + "\"catColor\":null,\"arrivedAt\":\"2026-10-18T00:00:00Z\"" + extra + "}}";
    }

    private void http(String body) throws Exception {
        mockMvc.perform(post("/internal/events").contentType(MediaType.APPLICATION_JSON).content(body)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + dataToken)).andExpect(status().isOk());
    }

    /** Data outbox 정본 봉투 — data-api {@code OutboxRelayIntegrationTest} 가 relay 가 보낸다고 확인한 모양. */
    private static String withdrawn(UUID user, long generation) {
        return "{\"eventId\":\"user.withdrawn:" + user + "\",\"schemaVersion\":1,\"type\":\"user.withdrawn\","
                + "\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,\"userId\":\"" + user + "\","
                + "\"locale\":null,\"subjectId\":\"" + user + "\",\"version\":7,"
                + "\"params\":{\"userId\":\"" + user + "\",\"authGeneration\":" + generation + "}}";
    }
}

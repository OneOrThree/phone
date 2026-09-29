package com.oneorthree.realtime.event;

import com.oneorthree.realtime.TestcontainersConfiguration;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.membership.client.GroupClient;
import com.oneorthree.realtime.message.repository.ChatReadCursorRepository;
import com.oneorthree.realtime.message.service.ChatUserFence;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
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
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
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

    @MockitoSpyBean
    private ChatUserFence chatUserFence;

    @MockitoSpyBean
    private EventRouter eventRouter;

    @Autowired
    private StringRedisTemplate redis;

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

    /** Data outbox 정본 봉투 — {@code IslandMembershipEvents#changed} 가 내보내는 params 모양 그대로다. */
    private static String membersUpdated(UUID island, String changeKind, UUID memberUserId, long version) {
        return "{\"eventId\":\"" + UUID.randomUUID() + "\",\"schemaVersion\":1,"
                + "\"type\":\"island.members.updated\",\"occurredAt\":\"2026-09-19T00:00:00Z\",\"scheduledAt\":null,"
                + "\"userId\":\"" + UUID.randomUUID() + "\",\"locale\":null,\"subjectId\":\"" + island + "\","
                + "\"version\":" + version + ",\"params\":{\"changeKind\":\"" + changeKind + "\",\"islandId\":\""
                + island + "\",\"memberUserId\":\"" + memberUserId + "\"}}";
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

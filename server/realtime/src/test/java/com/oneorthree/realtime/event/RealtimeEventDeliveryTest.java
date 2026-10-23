package com.oneorthree.realtime.event;

import com.oneorthree.realtime.common.redis.RedisKeys;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.connection.DefaultMessage;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 수신 집합 보관소의 <b>만료 정리</b> — 전달 경로에 얹힌 유일한 상태다.
 *
 * <p>벽시계에 기대지 않고 {@link Clock} 을 갈아 끼워 경계를 직접 만든다. 종전 구현은 넣을 때마다 맵
 * <b>전체</b>를 훑어(초당 R건이면 약 30R건) 정리 비용이 O(R²)였다 — 그 회귀를 여기서 잡는다:
 * 보관 건수가 아무리 많아도 만료가 지나면 <b>다음 한 번의 삽입</b>으로 전부 걷힌다.
 */
class RealtimeEventDeliveryTest {

    private static final Instant START = Instant.parse("2026-09-20T00:00:00Z");

    private final ObjectMapper mapper = new ObjectMapper();
    private final MovableClock clock = new MovableClock(START);
    private final RealtimeEventDelivery delivery = new RealtimeEventDelivery(
            mock(SimpMessagingTemplate.class), mock(StringRedisTemplate.class), mapper, clock, new SimpleMeterRegistry());

    @Test
    @DisplayName("만료가 지나면 보관 건수와 무관하게 다음 삽입 한 번으로 전부 걷힌다")
    void expiredEntriesAreDrainedFromTheHead() {
        UUID user = UUID.randomUUID();
        for (int i = 0; i < 1000; i++) {
            deliverEmote(UUID.randomUUID(), user);
        }
        assertThat(delivery.retainedEvents()).isEqualTo(1000);

        clock.advance(Duration.ofSeconds(31));
        deliverEmote(UUID.randomUUID(), user);

        assertThat(delivery.retainedEvents()).as("살아 있는 것은 방금 넣은 하나뿐이다").isEqualTo(1);
    }

    @Test
    @DisplayName("아직 살아 있는 항목은 머리에서 멈춰 남는다 — 정리가 앞에서만 일어난다")
    void liveEntriesSurviveTheSweep() {
        UUID user = UUID.randomUUID();
        UUID old = UUID.randomUUID();
        deliverEmote(old, user);

        clock.advance(Duration.ofSeconds(20));
        UUID fresh = UUID.randomUUID();
        deliverEmote(fresh, user);

        clock.advance(Duration.ofSeconds(11));
        deliverEmote(UUID.randomUUID(), user);

        assertThat(delivery.mayReceive(old, user)).as("31초 지난 것은 걷힌다").isFalse();
        assertThat(delivery.mayReceive(fresh, user)).as("11초짜리는 남는다").isTrue();
    }

    @Test
    @DisplayName("수신 집합에 없는 사람과 기록 없는 사건은 거절한다 — 보호 채널은 모르면 거절이다")
    void unknownEventsAndOutsidersAreRejected() {
        UUID member = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        deliverEmote(eventId, member);

        assertThat(delivery.mayReceive(eventId, member)).isTrue();
        assertThat(delivery.mayReceive(eventId, UUID.randomUUID())).isFalse();
        assertThat(delivery.mayReceive(UUID.randomUUID(), member)).isFalse();
    }

    @Test
    @DisplayName("관전 채널(수신 제한 없음)은 보관소를 쓰지 않는다")
    void unrestrictedChannelsDoNotUseTheStore() {
        delivery.deliverLocally("/topic/islands/" + UUID.randomUUID() + "/focus",
                event(UUID.randomUUID(), RealtimeEventType.FOCUS_MEMBER_UPDATED), Set.of());

        assertThat(delivery.retainedEvents()).isZero();
    }

    @Test
    @DisplayName("응원은 다른 replica 의 상대에게도 열린다 — 팬아웃을 건너도 수신 집합이 살아 있어야 다른 기기에서 보인다 (GROMO-2160)")
    void emoteRecipientsSurviveFanoutToAnotherReplica() {
        UUID sender = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        RealtimeEventDelivery replica = newDelivery(mock(StringRedisTemplate.class));

        // B 인스턴스는 아직 이 사건을 모른다 — 모르면 거절(fail-closed)이라 다른 기기에서 응원이 조용히 사라진다.
        assertThat(replica.mayReceive(eventId, other)).as("팬아웃 전에는 모른다").isFalse();

        fanOutEmote(eventId, Set.of(sender, other), replica);

        // 수신 집합이 그대로 건너왔다 — 두 사람은 열리고 남은 닫힌 채다.
        assertThat(replica.mayReceive(eventId, other)).as("상대의 다른 기기").isTrue();
        assertThat(replica.mayReceive(eventId, sender)).as("보낸 사람 본인의 다른 기기").isTrue();
        assertThat(replica.mayReceive(eventId, UUID.randomUUID())).as("수신 집합 밖의 사람").isFalse();
    }

    @Test
    @DisplayName("팬아웃으로 건너온 응원도 같은 보관 기간을 따른다 — 만료가 지나면 다른 replica 에서도 걷힌다 (GROMO-2160)")
    void fannedOutEmoteExpiresLikeALocalOne() {
        UUID other = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        RealtimeEventDelivery replica = newDelivery(mock(StringRedisTemplate.class));

        fanOutEmote(eventId, Set.of(UUID.randomUUID(), other), replica);
        assertThat(replica.mayReceive(eventId, other)).as("건너온 직후에는 열려 있다").isTrue();

        clock.advance(Duration.ofSeconds(31));

        assertThat(replica.mayReceive(eventId, other)).as("31초 지나면 replica 에서도 닫힌다").isFalse();
    }

    /**
     * 응원 한 건을 A 인스턴스에서 전달하고, 팬아웃 채널로 나간 «실제 wire 문자열»을 B({@code replica})의
     * 구독자에게 먹인다. 로컬 전달과 Redis 발행은 {@code deliver()} 한 번에 일어난다.
     */
    private void fanOutEmote(UUID eventId, Set<UUID> recipients, RealtimeEventDelivery replica) {
        StringRedisTemplate originRedis = mock(StringRedisTemplate.class);
        RealtimeEventEnvelope emote = event(eventId, RealtimeEventType.FOCUS_EMOTE);
        newDelivery(originRedis).deliver(emote, new RealtimeAudience.IslandAudience(emote.islandId(), recipients),
                "/topic/islands/" + emote.islandId() + "/emotes");

        ArgumentCaptor<String> wire = ArgumentCaptor.forClass(String.class);
        verify(originRedis).convertAndSend(eq(RedisKeys.EVENT_FANOUT_CHANNEL), wire.capture());

        new RealtimeEventFanoutSubscriber(replica, mock(InboundEventService.class), mapper).onMessage(
                new DefaultMessage(RedisKeys.EVENT_FANOUT_CHANNEL.getBytes(StandardCharsets.UTF_8),
                        wire.getValue().getBytes(StandardCharsets.UTF_8)), null);
    }

    private RealtimeEventDelivery newDelivery(StringRedisTemplate redis) {
        return new RealtimeEventDelivery(mock(SimpMessagingTemplate.class), redis, mapper, clock,
                new SimpleMeterRegistry());
    }

    private void deliverEmote(UUID eventId, UUID... recipients) {
        delivery.deliverLocally("/topic/islands/" + UUID.randomUUID() + "/emotes",
                event(eventId, RealtimeEventType.FOCUS_EMOTE), Set.of(recipients));
    }

    private RealtimeEventEnvelope event(UUID eventId, RealtimeEventType type) {
        ObjectNode payload = mapper.createObjectNode();
        UUID island = UUID.randomUUID();
        if (type == RealtimeEventType.FOCUS_EMOTE) {
            payload.put("userId", UUID.randomUUID().toString());
            payload.put("sessionId", UUID.randomUUID().toString());
            payload.put("type", FocusEmoteType.CHEER.wireName());
            payload.put("expiresAt", START.plusSeconds(3).toString());
            return new RealtimeEventEnvelope(eventId, type, island, null, START, payload);
        }
        payload.put("userId", UUID.randomUUID().toString());
        payload.put("sessionId", UUID.randomUUID().toString());
        payload.put("status", "paused");
        payload.put("subject", "영어 단어");
        payload.put("activeSeconds", 120);
        payload.put("serverNow", START.toString());
        payload.put("sessionVersion", 3);
        return new RealtimeEventEnvelope(eventId, type, island, 1L, START, payload);
    }

    /** 경계를 직접 만들기 위한 시계. 벽시계를 기다리면 31초짜리 테스트가 된다. */
    private static final class MovableClock extends Clock {
        private Instant now;

        private MovableClock(Instant now) {
            this.now = now;
        }

        private void advance(Duration amount) {
            now = now.plus(amount);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}

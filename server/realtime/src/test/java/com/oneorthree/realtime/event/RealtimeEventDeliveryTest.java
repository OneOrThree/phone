package com.oneorthree.realtime.event;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

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
            mock(SimpMessagingTemplate.class), mock(StringRedisTemplate.class), mapper, clock);

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

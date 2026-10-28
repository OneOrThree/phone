package com.oneorthree.realtime.sea;

import com.oneorthree.realtime.common.id.UuidV7;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

/**
 * 바다 방 사건 — 앱이 {@code /topic/sea/rooms/{roomId}}·{@code /user/queue/sea} 에서 받는 6필드 (GROMO-2300, N20).
 *
 * <p>섬 사건의 7필드 {@code RealtimeEventEnvelope} 를 쓰지 않는다 — 그쪽은 aggregateVersion 을 요구하고, type 이
 * Data 수신 목록에 자동으로 들어가며, 목적지가 섬 토픽으로 고정돼 있다. 바다 방 사건은 Data outbox 축이 없는
 * realtime 자체 사건이다.
 *
 * @param type {@code sea.room.assigned}·{@code sea.member.joined}·{@code sea.member.left}·{@code sea.member.updated}·
 *             {@code sea.emote}
 */
public record SeaRoomEvent(UUID eventId, int schemaVersion, String type, UUID roomId, Instant occurredAt,
        JsonNode payload) {

    public static final int SCHEMA_VERSION = 1;

    public static SeaRoomEvent of(String type, UUID roomId, Instant now, JsonNode payload) {
        return new SeaRoomEvent(UuidV7.next(), SCHEMA_VERSION, type, roomId, now, payload);
    }
}

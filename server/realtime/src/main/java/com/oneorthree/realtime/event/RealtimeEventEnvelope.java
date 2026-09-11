package com.oneorthree.realtime.event;

import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** 앱 이벤트 봉투. schemaVersion과 자원 버전은 별개이며 이 계약은 버전 1이다. */
public record RealtimeEventEnvelope(UUID eventId, int schemaVersion, RealtimeEventType type, UUID islandId,
        Long aggregateVersion, Instant occurredAt, JsonNode payload) {

    /** 현재 생산자는 스키마 1로 발행하며 자원 버전과 독립이다. */
    public RealtimeEventEnvelope(UUID eventId, RealtimeEventType type, UUID islandId,
            Long aggregateVersion, Instant occurredAt, JsonNode payload) {
        this(eventId, 1, type, islandId, aggregateVersion, occurredAt, payload);
    }

    public RealtimeEventEnvelope {
        if (schemaVersion != 1) {
            throw new IllegalArgumentException("지원하지 않는 이벤트 스키마 버전입니다.");
        }
        Objects.requireNonNull(eventId, "eventId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(occurredAt, "occurredAt");
        Objects.requireNonNull(payload, "payload");
        if (!payload.isObject()) {
            throw new IllegalArgumentException("이벤트 payload는 객체여야 합니다.");
        }
        if (type == RealtimeEventType.FOCUS_EMOTE ? aggregateVersion != null
                : aggregateVersion == null || aggregateVersion < 1
                || aggregateVersion > 9_007_199_254_740_991L) {
            throw new IllegalArgumentException("이벤트 자원 버전이 올바르지 않습니다.");
        }
        if (islandId == null && type != RealtimeEventType.WALLET_UPDATED
                && type != RealtimeEventType.INVENTORY_UPDATED) {
            throw new IllegalArgumentException("섬 식별자가 필요합니다.");
        }
        EventPayloadValidator.validate(type, islandId, aggregateVersion, payload);
        payload = payload.deepCopy();
    }

    @Override
    public JsonNode payload() {
        return payload.deepCopy();
    }
}

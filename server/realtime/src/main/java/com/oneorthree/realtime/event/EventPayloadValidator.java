package com.oneorthree.realtime.event;

import tools.jackson.databind.JsonNode;

import java.util.UUID;

/** 전달 골격의 버전·자산 소유 안전 불변식. 전체 도메인 스키마 검증은 생산자 활성화의 선행 조건이다. */
final class EventPayloadValidator {

    private EventPayloadValidator() {
    }

    static void validate(RealtimeEventType type, UUID islandId, Long version, JsonNode payload) {
        if (payload.has("destination")) {
            throw new IllegalArgumentException("이벤트 payload에 전달 경로를 지정할 수 없습니다.");
        }
        boolean versionRequired = switch (type) {
            case FOCUS_MEMBER_UPDATED, REST_MEMBER_UPDATED, FOCUS_EMOTE, MESSAGE_CREATED -> false;
            default -> true;
        };
        JsonNode payloadVersion = payload.get("version");
        if (versionRequired || payloadVersion != null) {
            if (payloadVersion == null || !payloadVersion.isIntegralNumber()
                    || !payloadVersion.canConvertToLong() || version == null || payloadVersion.longValue() != version) {
                throw new IllegalArgumentException("payload 버전과 자원 버전이 일치하지 않습니다.");
            }
        }
        if (type == RealtimeEventType.MESSAGE_CREATED && version != 1L) {
            throw new IllegalArgumentException("불변 메시지의 최초 버전은 1입니다.");
        }
        if (type == RealtimeEventType.ISLAND_UPDATED || type == RealtimeEventType.ISLAND_MEMBERS_UPDATED) {
            if (!islandId.equals(uuidField(payload, "islandId"))) {
                throw new IllegalArgumentException("payload의 섬이 일치하지 않습니다.");
            }
        }
        if (type == RealtimeEventType.WALLET_UPDATED || type == RealtimeEventType.INVENTORY_UPDATED) {
            UUID ownerId = ownerId(payload);
            String expectedOwner = islandId == null ? "user" : "island";
            if (!expectedOwner.equals(textField(payload, "ownerType"))
                    || islandId != null && !islandId.equals(ownerId)) {
                throw new IllegalArgumentException("자산 소유 범위가 일치하지 않습니다.");
            }
            if (type == RealtimeEventType.WALLET_UPDATED) {
                String expectedCurrency = islandId == null ? "fish" : "village_points";
                if (!expectedCurrency.equals(textField(payload, "currency"))) {
                    throw new IllegalArgumentException("자산 소유자와 재화가 일치하지 않습니다.");
                }
            }
        }
    }

    static UUID ownerId(JsonNode payload) {
        return uuidField(payload, "ownerId");
    }

    private static UUID uuidField(JsonNode payload, String name) {
        String value = textField(payload, name);
        UUID id = UUID.fromString(value);
        if (!id.toString().equals(value)) {
            throw new IllegalArgumentException("식별자는 소문자 UUID여야 합니다.");
        }
        return id;
    }

    private static String textField(JsonNode payload, String name) {
        JsonNode value = payload.get(name);
        if (value == null || !value.isString()) {
            throw new IllegalArgumentException("이벤트 필수 문자열이 없습니다.");
        }
        return value.stringValue();
    }
}

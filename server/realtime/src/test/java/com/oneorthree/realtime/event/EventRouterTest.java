package com.oneorthree.realtime.event;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class EventRouterTest {
    private final UUID island = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final ObjectMapper mapper = new ObjectMapper();
    private final RealtimeDelivery delivery = mock(RealtimeDelivery.class);
    private final EventRouter router = new EventRouter(delivery);

    @Test
    void allFifteenWireTypesHaveFixedRoutes() {
        assertThat(RealtimeEventType.values()).hasSize(15);
        for (RealtimeEventType type : RealtimeEventType.values()) {
            RealtimeEventEnvelope event = event(type, island);
            // 응원만 수신 집합이 필수다 — 수신 자격이 구독 인가보다 좁아서다(GROMO-1765).
            RealtimeAudience audience = switch (type) {
                case JOIN_REQUEST_UPDATED -> new RealtimeAudience.UserAudience(Set.of(user));
                case FOCUS_EMOTE -> new RealtimeAudience.IslandAudience(island, Set.of(user));
                default -> new RealtimeAudience.IslandAudience(island);
            };
            router.route(event, audience);
            String suffix = switch (type) {
                case FOCUS_MEMBER_UPDATED, GOLDEN_FISH_CAUGHT -> "focus";
                case REST_MEMBER_UPDATED -> "rest";
                case FOCUS_EMOTE -> "emotes";
                case PLAYBACK_UPDATED -> "playback";
                case MESSAGE_CREATED -> "messages";
                default -> "events";
            };
            verify(delivery).deliver(event, audience, type == RealtimeEventType.JOIN_REQUEST_UPDATED
                    ? "/user/queue/events" : "/topic/islands/" + island + "/" + suffix);
            assertThat(mapper.writeValueAsString(type)).isEqualTo("\"" + type.wireName() + "\"");
        }
    }

    @Test
    void serializedEnvelopeCarriesSchemaVersionIndependentOfResourceVersion() {
        for (RealtimeEventType type : RealtimeEventType.values()) {
            RealtimeEventEnvelope original = event(type, island);
            JsonNode json = mapper.readTree(mapper.writeValueAsString(original));
            assertThat(json.size()).isEqualTo(7);
            assertThat(json.get("schemaVersion").asInt()).isEqualTo(1);
            if (type == RealtimeEventType.FOCUS_EMOTE) {
                assertThat(json.get("aggregateVersion").isNull()).isTrue();
            }
            assertThat(mapper.readValue(json.toString(), RealtimeEventEnvelope.class)).isEqualTo(original);
        }
    }

    @Test
    void absentAndUnsupportedSchemaVersionsAreRejected() {
        ObjectNode json = (ObjectNode) mapper.readTree(
                mapper.writeValueAsString(event(RealtimeEventType.ISLAND_UPDATED, island)));
        json.remove("schemaVersion");
        assertThatThrownBy(() -> mapper.readValue(json.toString(), RealtimeEventEnvelope.class))
                .isInstanceOf(RuntimeException.class);
        json.put("schemaVersion", 2);
        assertThatThrownBy(() -> mapper.readValue(json.toString(), RealtimeEventEnvelope.class))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void personalAssetsNeverReachIslandOrAnotherUsersQueue() {
        for (RealtimeEventType type : new RealtimeEventType[] {
                RealtimeEventType.WALLET_UPDATED, RealtimeEventType.INVENTORY_UPDATED}) {
            RealtimeEventEnvelope personal = event(type, null);
            assertThatThrownBy(() -> router.route(personal, new RealtimeAudience.IslandAudience(island)))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> router.route(personal,
                    new RealtimeAudience.UserAudience(Set.of(user, UUID.randomUUID()))))
                    .isInstanceOf(IllegalArgumentException.class);
            RealtimeAudience owner = new RealtimeAudience.UserAudience(Set.of(user));
            router.route(personal, owner);
            verify(delivery).deliver(personal, owner, "/user/queue/events");
        }
    }

    @Test
    void mismatchedIslandAndBroadcastJoinRequestAreRejected() {
        assertThatThrownBy(() -> router.route(event(RealtimeEventType.ISLAND_UPDATED, island),
                new RealtimeAudience.IslandAudience(UUID.randomUUID()))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> router.route(event(RealtimeEventType.JOIN_REQUEST_UPDATED, island),
                new RealtimeAudience.IslandAudience(island))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> router.route(event(RealtimeEventType.MESSAGE_CREATED, island),
                new RealtimeAudience.UserAudience(Set.of(user)))).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(delivery);
    }

    @Test
    void payloadDestinationIsRejectedAndMutationsAreIsolated() {
        ObjectNode payload = mapper.createObjectNode().put("version", 1).put("islandId", island.toString());
        RealtimeEventEnvelope event = new RealtimeEventEnvelope(UUID.randomUUID(),
                RealtimeEventType.ISLAND_UPDATED, island, 1L, Instant.now(), payload);
        payload.put("private", "later mutation");
        ((ObjectNode) event.payload()).put("another", "mutation");
        assertThat(event.payload().has("private")).isFalse();
        assertThat(event.payload().has("another")).isFalse();
        payload.put("destination", "/topic/groups/**");
        assertThatThrownBy(() -> new RealtimeEventEnvelope(UUID.randomUUID(),
                RealtimeEventType.ISLAND_UPDATED, island, 1L, Instant.now(), payload))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void unsafeVersionsAndDifferentPersonalOwnerAreRejected() {
        assertThatThrownBy(() -> new RealtimeEventEnvelope(UUID.randomUUID(),
                RealtimeEventType.MESSAGE_CREATED, island, 9_007_199_254_740_992L,
                Instant.now(), mapper.createObjectNode())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> router.route(event(RealtimeEventType.WALLET_UPDATED, null),
                new RealtimeAudience.UserAudience(Set.of(UUID.randomUUID()))))
                .isInstanceOf(IllegalArgumentException.class);
        ObjectNode mismatch = mapper.createObjectNode().put("version", 2).put("islandId", island.toString());
        assertThatThrownBy(() -> new RealtimeEventEnvelope(UUID.randomUUID(),
                RealtimeEventType.ISLAND_UPDATED, island, 1L, Instant.now(), mismatch))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void emoteWithoutRecipientsIsRejected() {
        // 빈 집합은 «제한 없음»으로 읽히므로, 응원에 그걸 허용하면 실수 하나가 전원 공개가 된다.
        assertThatThrownBy(() -> router.route(event(RealtimeEventType.FOCUS_EMOTE, island),
                new RealtimeAudience.IslandAudience(island))).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(delivery);
    }

    @Test
    void personalQueueDeliveryStillFailsClosed() {
        // 섬 토픽은 열렸지만(GROMO-1765) /user/queue/events 는 event 별 owner·방장 권한 재검사가
        // 없어 계속 닫혀 있다. 조용히 성공한 척하지 않는다.
        EventRouter router = new EventRouter(new RealtimeEventDelivery(
                mock(org.springframework.messaging.simp.SimpMessagingTemplate.class),
                mock(org.springframework.data.redis.core.StringRedisTemplate.class), mapper,
                java.time.Clock.systemUTC()));
        assertThatThrownBy(() -> router.route(event(RealtimeEventType.JOIN_REQUEST_UPDATED, island),
                new RealtimeAudience.UserAudience(Set.of(user)))).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void versionAndIslandRequirementsAreEnforced() {
        assertThatThrownBy(() -> new RealtimeEventEnvelope(UUID.randomUUID(), RealtimeEventType.FOCUS_EMOTE,
                island, 1L, Instant.now(), mapper.createObjectNode())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RealtimeEventEnvelope(UUID.randomUUID(), RealtimeEventType.ISLAND_UPDATED,
                island, null, Instant.now(), mapper.createObjectNode())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> event(RealtimeEventType.MESSAGE_CREATED, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private RealtimeEventEnvelope event(RealtimeEventType type, UUID islandId) {
        ObjectNode payload = mapper.createObjectNode();
        if (type != RealtimeEventType.FOCUS_EMOTE) {
            payload.put("version", 1);
        }
        if (type == RealtimeEventType.GOLDEN_FISH_CAUGHT) {
            // 황금 물고기도 도메인 필드까지 본다 — 2명 미만이거나 배분량이 어긋난 봉투는 앱이 잘못된
            // 컷신을 재생한다(GROMO-1956).
            payload.put("drawnAt", Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MINUTES).toString());
            payload.put("reward", 50);
            payload.put("sharePerMember", 25);
            tools.jackson.databind.node.ArrayNode members = payload.putArray("members");
            for (int i = 0; i < 2; i++) {
                members.addObject().put("userId", UUID.randomUUID().toString())
                        .put("sessionId", UUID.randomUUID().toString());
            }
        }
        if (islandId != null) {
            payload.put("islandId", islandId.toString());
        }
        if (type == RealtimeEventType.WALLET_UPDATED || type == RealtimeEventType.INVENTORY_UPDATED) {
            payload.put("ownerType", islandId == null ? "user" : "island");
            payload.put("ownerId", (islandId == null ? user : islandId).toString());
            payload.put("currency", islandId == null ? "fish" : "village_points");
        }
        if (type == RealtimeEventType.FOCUS_MEMBER_UPDATED || type == RealtimeEventType.REST_MEMBER_UPDATED) {
            // 활성화된 주민 사건 둘도 도메인 필드까지 검증한다 — 서비스 토큰은 「Data 가 보냈다」만
            // 증명하지 「내용이 계약을 지킨다」를 증명하지 않는다(GROMO-1765).
            payload.put("userId", user.toString());
            payload.put("sessionId", UUID.randomUUID().toString());
            payload.put("status", "paused");
            payload.put("serverNow", Instant.now().toString());
            payload.put("sessionVersion", 3);
            if (type == RealtimeEventType.FOCUS_MEMBER_UPDATED) {
                payload.put("subject", "영어 단어");
                payload.put("activeSeconds", 120);
            } else {
                // nullable 필드는 키를 유지한다(LLD §6) — 「키 없음」은 거절, 「값이 null」은 삭제 신호다.
                // 다만 «상태와의 조합»이 맞아야 한다: paused 면 둘 다 있어야 하고, 아니면 둘 다 null 이다.
                payload.put("restStartedAt", Instant.now().toString());
                payload.put("restSeat", 1);
            }
        }
        if (type == RealtimeEventType.FOCUS_MEMBER_UPDATED || type == RealtimeEventType.REST_MEMBER_UPDATED) {
            // 활성화된 주민 사건 둘도 도메인 필드까지 검증한다 — 서비스 토큰은 「Data 가 보냈다」만
            // 증명하지 「내용이 계약을 지킨다」를 증명하지 않는다(GROMO-1765).
            payload.put("userId", user.toString());
            payload.put("sessionId", UUID.randomUUID().toString());
            payload.put("status", "paused");
            payload.put("serverNow", Instant.now().toString());
            payload.put("sessionVersion", 3);
            if (type == RealtimeEventType.FOCUS_MEMBER_UPDATED) {
                payload.put("subject", "영어 단어");
                payload.put("activeSeconds", 120);
            } else {
                // nullable 필드는 키를 유지한다(LLD §6) — 「키 없음」은 거절, 「값이 null」은 삭제 신호다.
                // 다만 «상태와의 조합»이 맞아야 한다: paused 면 둘 다 있어야 하고, 아니면 둘 다 null 이다.
                payload.put("restStartedAt", Instant.now().toString());
                payload.put("restSeat", 1);
            }
        }
        if (type == RealtimeEventType.FOCUS_EMOTE) {
            // 응원만 도메인 필드까지 검증한다 — 생산자가 Data 가 아니라 «앱의 STOMP 프레임»이라서다.
            payload.put("userId", user.toString());
            payload.put("sessionId", UUID.randomUUID().toString());
            payload.put("type", FocusEmoteType.CHEER.wireName());
            payload.put("expiresAt", Instant.now().plusSeconds(3).toString());
        }
        return new RealtimeEventEnvelope(UUID.randomUUID(), type, islandId,
                type == RealtimeEventType.FOCUS_EMOTE ? null : 1L, Instant.now(), payload);
    }
}

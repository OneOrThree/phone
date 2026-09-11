package com.oneorthree.realtime.event;

import org.junit.jupiter.api.Test;
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
    void allFourteenWireTypesHaveFixedRoutes() {
        assertThat(RealtimeEventType.values()).hasSize(14);
        for (RealtimeEventType type : RealtimeEventType.values()) {
            RealtimeEventEnvelope event = event(type, island);
            RealtimeAudience audience = type == RealtimeEventType.JOIN_REQUEST_UPDATED
                    ? new RealtimeAudience.UserAudience(Set.of(user))
                    : new RealtimeAudience.IslandAudience(island);
            router.route(event, audience);
            String suffix = switch (type) {
                case FOCUS_MEMBER_UPDATED -> "focus";
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
    void defaultDeliveryFailsClosed() {
        EventRouter disabled = new EventRouter(new DisabledRealtimeDelivery());
        assertThatThrownBy(() -> disabled.route(event(RealtimeEventType.ISLAND_UPDATED, island),
                new RealtimeAudience.IslandAudience(island))).isInstanceOf(IllegalStateException.class);
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
        if (islandId != null) {
            payload.put("islandId", islandId.toString());
        }
        if (type == RealtimeEventType.WALLET_UPDATED || type == RealtimeEventType.INVENTORY_UPDATED) {
            payload.put("ownerType", islandId == null ? "user" : "island");
            payload.put("ownerId", (islandId == null ? user : islandId).toString());
            payload.put("currency", islandId == null ? "fish" : "village_points");
        }
        return new RealtimeEventEnvelope(UUID.randomUUID(), type, islandId,
                type == RealtimeEventType.FOCUS_EMOTE ? null : 1L, Instant.now(), payload);
    }
}

package com.oneorthree.realtime.event;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.config.OutboundAuthzCache;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.membership.CurrentMembershipDecisionCache;
import com.oneorthree.realtime.membership.MembershipService;
import com.oneorthree.realtime.movement.stomp.MovementSubscriptionListener;
import com.oneorthree.realtime.sea.SeaRooms;
import com.oneorthree.realtime.message.service.ChatUserFence;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AppearanceDeliveryTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final EventRouter router = mock(EventRouter.class);
    private final SeaRooms sea = mock(SeaRooms.class);
    private final InboundEventService service = new InboundEventService(jdbc, mock(ChatUserFence.class), router,
            mock(MembershipService.class), mock(BlockedUsers.class), mock(MovementSubscriptionListener.class), sea,
            mock(CurrentMembershipDecisionCache.class), mock(OutboundAuthzCache.class),
            mock(RealtimeSessionRegistry.class), mock(JwtValidator.class), Clock.systemUTC(),
            mock(RealtimeEventDelivery.class), new SimpleMeterRegistry());
    private final UUID user = UUID.randomUUID();

    @Test
    void userAxisOnlyForwardsToSeaAndIslandAxisOnlyToIsland() {
        when(jdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any())).thenReturn(1);
        ObjectNode global = event(null);
        service.accept(global);
        verify(sea).publishAppearance(eq(user), eq(global.path("params")));
        verify(router, never()).route(any(), any());

        UUID island = UUID.randomUUID();
        service.accept(event(island));
        verify(router).route(any(RealtimeEventEnvelope.class), eq(new RealtimeAudience.IslandAudience(island)));
        // 두 섬에 속해도 바다에는 사용자 축 한 건만 전달된다.
        verify(sea).publishAppearance(any(), any());
    }

    @Test
    void malformedLookDoesNotReadOrWriteSeaState() {
        when(jdbc.update(anyString(), ArgumentMatchers.<Object>any(), ArgumentMatchers.<Object>any())).thenReturn(1);
        ObjectNode malformed = event(null);
        ((ObjectNode) malformed.path("params").path("appearance")).put("head", 42);
        service.accept(malformed);
        verify(sea, never()).publishAppearance(any(), any());
        verify(router, never()).route(any(), any());
    }

    private ObjectNode event(UUID island) {
        ObjectNode event = new ObjectMapper().createObjectNode();
        event.put("eventId", UUID.randomUUID().toString()).put("schemaVersion", 1)
                .put("type", "member.appearance.updated").put("version", 2)
                .put("occurredAt", Instant.now().toString());
        if (island == null) event.putNull("subjectId");
        else event.put("subjectId", island.toString());
        ObjectNode params = event.putObject("params").put("userId", user.toString()).put("version", 2);
        params.putObject("appearance").putNull("clothes").putNull("decor").put("head", "duck")
                .putNull("neck").putNull("shoes").put("hull", "raft").put("position", "front");
        return event;
    }
}

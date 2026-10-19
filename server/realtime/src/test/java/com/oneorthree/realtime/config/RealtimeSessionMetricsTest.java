package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RealtimeSessionMetricsTest {

    @Test
    void countsConnectionsAuthenticationSubscriptionsAndCleanup() {
        RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        try {
            sessions.bindTo(meters);
            WebSocketSession socket = mock(WebSocketSession.class);
            when(socket.getId()).thenReturn("session");
            sessions.opened(socket);
            assertThat(meters.get("realtime.websocket.sessions").gauge().value()).isEqualTo(1);
            assertThat(meters.get("realtime.stomp.sessions").gauge().value()).isZero();
            sessions.register("session", new ChatPrincipal(UUID.randomUUID(), "Bearer test"));
            sessions.subscribe("session", "first", "/topic/first");
            sessions.subscribe("session", "first", "/topic/first");
            sessions.subscribe("session", "second", "/topic/second");
            assertThat(meters.get("realtime.stomp.sessions").gauge().value()).isEqualTo(1);
            assertThat(meters.get("realtime.stomp.subscriptions").gauge().value()).isEqualTo(2);
            sessions.unsubscribe("session", "first");
            assertThat(meters.get("realtime.stomp.subscriptions").gauge().value()).isEqualTo(1);
            sessions.closed("session");
            assertThat(meters.get("realtime.websocket.sessions").gauge().value()).isZero();
            assertThat(meters.get("realtime.stomp.sessions").gauge().value()).isZero();
            assertThat(meters.get("realtime.stomp.subscriptions").gauge().value()).isZero();
        } finally {
            meters.close();
        }
    }
}

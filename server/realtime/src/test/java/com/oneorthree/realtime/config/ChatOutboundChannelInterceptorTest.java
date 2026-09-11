package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatOutboundChannelInterceptorTest {
    private final UUID user = UUID.randomUUID();
    private final UUID island = UUID.randomUUID();
    private final JwtValidator jwt = mock(JwtValidator.class);
    private final ChatAccessGuard guard = mock(ChatAccessGuard.class);
    private final RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
    private final ChatOutboundChannelInterceptor interceptor = new ChatOutboundChannelInterceptor(sessions, jwt, guard);

    @BeforeEach
    void setUp() {
        sessions.register("socket", new ChatPrincipal(user, "Bearer token"));
        when(jwt.extractUserId("token")).thenReturn(Optional.of(user));
    }

    @Test
    void existingSubscriptionIsReauthorizedAtDelivery() {
        Message<?> message = frame("socket", "/topic/groups/" + island);
        assertThat(interceptor.beforeHandle(message, null, null)).isSameAs(message);
        verify(guard).requireCanChat(island, user, "Bearer token");
        doThrow(new IllegalStateException("membership or presence unavailable"))
                .when(guard).requireCanChat(island, user, "Bearer token");
        assertThat(interceptor.beforeHandle(message, null, null)).isNull();
    }

    @Test
    void expiredOrUnknownSessionCannotReceiveChat() {
        assertThat(interceptor.beforeHandle(frame("unknown", "/topic/groups/" + island), null, null)).isNull();
        when(jwt.extractUserId("token")).thenReturn(Optional.empty());
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/groups/" + island), null, null)).isNull();
        assertThat(interceptor.beforeHandle(frame("socket", "/queue/duplicates-usersocket"), null, null)).isNull();
    }

    @Test
    void duplicateReplyIsBlockedDuringFocusButErrorIsDelivered() {
        doThrow(new IllegalStateException("focus" )).when(guard).requireNotFocusing(user);
        assertThat(interceptor.beforeHandle(frame("socket", "/queue/duplicates-usersocket"), null, null)).isNull();
        Message<?> error = frame("socket", "/queue/errors-usersocket");
        assertThat(interceptor.beforeHandle(error, null, null)).isSameAs(error);
    }

    @Test
    void unimplementedEventDeliveryIsClosedEvenForAuthenticatedSockets() {
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/islands/" + island + "/events"), null, null)).isNull();
        assertThat(interceptor.beforeHandle(frame("socket", "/queue/events-usersocket"), null, null)).isNull();
    }

    private Message<?> frame(String session, String destination) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId(session);
        headers.setDestination(destination);
        return MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());
    }
}

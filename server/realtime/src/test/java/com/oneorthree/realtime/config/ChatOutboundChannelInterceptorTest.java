package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.event.RealtimeEventDelivery;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatOutboundChannelInterceptorTest {
    private final UUID user = UUID.randomUUID();
    private final UUID island = UUID.randomUUID();
    private final JwtValidator jwt = mock(JwtValidator.class);
    private final ChatAccessGuard guard = mock(ChatAccessGuard.class);
    private final RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
    private final RealtimeEventDelivery delivery = mock(RealtimeEventDelivery.class);
    private final BlockedUsers blockedUsers = mock(BlockedUsers.class);
    private final ChatOutboundChannelInterceptor interceptor =
            new ChatOutboundChannelInterceptor(sessions, jwt, guard, delivery,
                new tools.jackson.databind.ObjectMapper(), blockedUsers);

    @BeforeEach
    void setUp() {
        sessions.register("socket", new ChatPrincipal(user, "Bearer token"));
        when(jwt.extractUserId("token")).thenReturn(Optional.of(user));
        when(blockedUsers.enabled()).thenReturn(true);
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
    void credentialRejectedDuringCurrentAuthorizationClosesTheSocket() throws Exception {
        // 현재 인가 조회를 기다리는 사이 AT 가 만료되면 관문이 자격 거절을 던진다. 프레임만 버리면
        // 수신 전용 앱이 만료를 모른 채 남으므로, 전달 직전 JWT 재검증과 같이 실제 소켓을 닫아야 한다.
        WebSocketSession socket = openSocket("socket");
        doThrow(new UpstreamRejectedCredentialException())
                .when(guard).requireCanChat(island, user, "Bearer token");

        assertThat(interceptor.beforeHandle(frame("socket", "/topic/groups/" + island), null, null)).isNull();

        verify(socket).close(CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
    }

    @Test
    void transientUpstreamFailureBlocksTheFrameButKeepsTheSocket() throws Exception {
        // 자격은 유효하고 Data 가 잠시 응답하지 못했을 뿐이다. 본문은 막되 연결까지 끊지는 않는다.
        WebSocketSession socket = openSocket("socket");
        doThrow(new UpstreamUnavailableException())
                .when(guard).requireCanChat(island, user, "Bearer token");

        assertThat(interceptor.beforeHandle(frame("socket", "/topic/groups/" + island), null, null)).isNull();

        verify(socket, never()).close(any(CloseStatus.class));
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

    // ── GROMO-2247 이동 채널 ─────────────────────────────────────────────

    @Test
    void movementFramesPassAfterReauthenticationOnly() throws Exception {
        // N9 — 이동 두 토픽은 JWT 재검증만 보고 통과한다(멤버십·집중·차단·사건 수신 집합을 보지 않는다).
        for (String suffix : new String[] {"/movement", "/movement/snapshot"}) {
            Message<?> message = frame("socket", "/topic/islands/" + island + suffix, "{\"type\":\"Snapshot\"}");
            assertThat(interceptor.beforeHandle(message, null, null)).isSameAs(message);
        }
        org.mockito.Mockito.verifyNoInteractions(guard, delivery);
        verify(blockedUsers, never()).hasBlocked(any(), any());
        // 열거 밖 이동 하위 목적지는 계속 닫혀 있다.
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/islands/" + island + "/movement/other"), null,
                null)).isNull();

        WebSocketSession socket = openSocket("socket");
        when(jwt.extractUserId("token")).thenReturn(Optional.empty());
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/islands/" + island + "/movement"), null, null))
                .as("만료 토큰의 세션은 이동 프레임도 못 받는다").isNull();
        verify(socket).close(CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
    }

    // ── GROMO-2182 받는 사람 기준 차단 ─────────────────────────────────────

    @Test
    void chatFromBlockedSenderIsNotDeliveredToTheBlocker() {
        UUID blocked = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        when(blockedUsers.hasBlocked(user, blocked)).thenReturn(true);

        assertThat(interceptor.beforeHandle(chat(blocked), null, null)).isNull();
        Message<?> fromOther = chat(other);
        assertThat(interceptor.beforeHandle(fromOther, null, null)).isSameAs(fromOther);
    }

    @Test
    void chatIsNotDeliveredWhenBlockLookupFails() throws Exception {
        // fail-closed(2026-10-01 결정) — 판정 불가는 전달 근거가 없다. 자격은 유효하므로 소켓은 유지한다.
        WebSocketSession socket = openSocket("socket");
        UUID sender = UUID.randomUUID();
        when(blockedUsers.hasBlocked(user, sender)).thenThrow(new UpstreamUnavailableException());

        assertThat(interceptor.beforeHandle(chat(sender), null, null)).isNull();
        verify(socket, never()).close(any(CloseStatus.class));
    }

    @Test
    void chatWhoseSenderCannotBeReadIsNotDelivered() {
        String group = "/topic/groups/" + island;
        assertThat(interceptor.beforeHandle(frame("socket", group, "{}"), null, null)).isNull();
        assertThat(interceptor.beforeHandle(frame("socket", group, "{\"senderId\":\"not-a-uuid\"}"), null, null))
                .isNull();
        assertThat(interceptor.beforeHandle(frame("socket", group, "not json"), null, null)).isNull();
        verify(blockedUsers, never()).hasBlocked(any(), any());
    }

    @Test
    void switchedOffFilterSkipsSenderExtractionEntirely() {
        // OFF = 이 기능 이전과 같은 경로. 발신자 판독의 fail-closed 가 OFF 에서 새면 안 된다.
        when(blockedUsers.enabled()).thenReturn(false);
        UUID eventId = UUID.randomUUID();
        when(delivery.mayReceive(eventId, user)).thenReturn(true);

        Message<?> noSender = frame("socket", "/topic/groups/" + island, "{\"content\":\"x\"}");
        assertThat(interceptor.beforeHandle(noSender, null, null)).isSameAs(noSender);
        Message<?> emoteWithoutUser = frame("socket", "/topic/islands/" + island + "/emotes",
                "{\"eventId\":\"" + eventId + "\",\"payload\":{}}");
        assertThat(interceptor.beforeHandle(emoteWithoutUser, null, null)).isSameAs(emoteWithoutUser);
        verify(blockedUsers, never()).hasBlocked(any(), any());
    }

    @Test
    void chatFromWithdrawnSenderHasNobodyToFilter() {
        // 탈퇴 발신자는 senderId 가 null 로 나간다(GROMO-1946) — 거를 대상이 없으니 보낸다.
        Message<?> message = frame("socket", "/topic/groups/" + island, "{\"senderId\":null}");
        assertThat(interceptor.beforeHandle(message, null, null)).isSameAs(message);
    }

    @Test
    void emoteFromBlockedSenderIsNotDeliveredAndLookupFailureIsFailClosed() {
        UUID blocked = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        when(delivery.mayReceive(eventId, user)).thenReturn(true);
        when(blockedUsers.hasBlocked(user, blocked)).thenReturn(true);

        assertThat(interceptor.beforeHandle(emote(eventId, blocked), null, null)).isNull();
        Message<?> fromOther = emote(eventId, other);
        assertThat(interceptor.beforeHandle(fromOther, null, null)).isSameAs(fromOther);

        when(blockedUsers.hasBlocked(user, other)).thenThrow(new UpstreamUnavailableException());
        assertThat(interceptor.beforeHandle(emote(eventId, other), null, null)).isNull();
        // 발신자가 없는 응원은 판정 근거가 없다.
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/islands/" + island + "/emotes",
                "{\"eventId\":\"" + eventId + "\",\"payload\":{}}"), null, null)).isNull();
    }

    private Message<?> chat(UUID sender) {
        return frame("socket", "/topic/groups/" + island, "{\"senderId\":\"" + sender + "\",\"content\":\"x\"}");
    }

    private Message<?> emote(UUID eventId, UUID sender) {
        return frame("socket", "/topic/islands/" + island + "/emotes", "{\"eventId\":\"" + eventId
                + "\",\"type\":\"focus.emote\",\"payload\":{\"userId\":\"" + sender + "\"}}");
    }

    private WebSocketSession openSocket(String id) {
        WebSocketSession socket = mock(WebSocketSession.class);
        when(socket.getId()).thenReturn(id);
        when(socket.isOpen()).thenReturn(true);
        sessions.opened(socket);
        return socket;
    }

    private Message<?> frame(String session, String destination) {
        return frame(session, destination, "{\"senderId\":null}");
    }

    private Message<?> frame(String session, String destination, String payload) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId(session);
        headers.setDestination(destination);
        return MessageBuilder.createMessage(payload.getBytes(StandardCharsets.UTF_8), headers.getMessageHeaders());
    }
}

package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.block.BlockedUsers;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.redis.Sourced;
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
    private final io.micrometer.core.instrument.simple.SimpleMeterRegistry meters =
            new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
    private final com.oneorthree.realtime.sea.SeaRooms seaRooms = mock(com.oneorthree.realtime.sea.SeaRooms.class);
    private final ChatOutboundChannelInterceptor interceptor =
            new ChatOutboundChannelInterceptor(sessions, jwt, guard, delivery,
                new tools.jackson.databind.ObjectMapper(), blockedUsers, seaRooms, meters);

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
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/islands/" + island + "/playback"), null, null))
                .isNull();
        assertThat(interceptor.beforeHandle(frame("socket", "/queue/events-usersocket"), null, null)).isNull();
    }

    // ── GROMO-2302 섬 events 채널 ─────────────────────────────────────────

    @Test
    void islandEventsReachCurrentResidentsOnly() throws Exception {
        // 주민 — 캐시 멤버십 재검사를 통과하면 그대로 전달한다(집중 검사는 섞지 않는다).
        Message<?> resident = arrival(UUID.randomUUID());
        assertThat(interceptor.beforeHandle(resident, null, null)).isSameAs(resident);
        verify(guard).requireMember(island, user, "Bearer token");
        verify(guard, never()).requireCanChat(any(), any(), any());
        verify(guard, never()).requireNotFocusing(any());

        // 비주민(강퇴 뒤 등)·조회 불가는 프레임만 버리고 소켓은 둔다(fail-closed).
        WebSocketSession socket = openSocket("socket");
        doThrow(new IllegalStateException("not a member")).when(guard).requireMember(island, user, "Bearer token");
        assertThat(interceptor.beforeHandle(arrival(UUID.randomUUID()), null, null))
                .isNull();
        doThrow(new UpstreamUnavailableException()).when(guard).requireMember(island, user, "Bearer token");
        assertThat(interceptor.beforeHandle(arrival(UUID.randomUUID()), null, null))
                .isNull();
        verify(socket, never()).close(any(CloseStatus.class));
    }

    @Test
    void islandEventsAreDroppedForExpiredTokens() throws Exception {
        WebSocketSession socket = openSocket("socket");
        when(jwt.extractUserId("token")).thenReturn(Optional.empty());

        assertThat(interceptor.beforeHandle(arrival(UUID.randomUUID()), null, null))
                .isNull();
        verify(guard, never()).requireMember(any(), any(), any());
        verify(socket).close(CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
    }

    @Test
    void islandEventFromABlockedArriverIsNotDeliveredToTheBlocker() throws Exception {
        // 채팅·응원과 같은 받는 사람 기준 차단 필터(GROMO-2182) — 보내는 사람은 payload.userId(도착자)다.
        WebSocketSession socket = openSocket("socket");
        UUID blocked = UUID.randomUUID();
        when(blockedUsers.hasBlocked(user, blocked)).thenReturn(true);

        assertThat(interceptor.beforeHandle(arrival(blocked), null, null)).isNull();
        Message<?> fromOther = arrival(UUID.randomUUID());
        assertThat(interceptor.beforeHandle(fromOther, null, null)).isSameAs(fromOther);
        verify(socket, never()).close(any(CloseStatus.class));
    }

    @Test
    void switchedOffFilterDeliversIslandEventsWithoutReadingTheArriver() {
        // OFF = 이 기능 이전과 같은 경로 — 차단 관계여도 events 프레임은 멤버십만 보고 나간다.
        when(blockedUsers.enabled()).thenReturn(false);
        UUID blocked = UUID.randomUUID();
        when(blockedUsers.hasBlocked(user, blocked)).thenReturn(true);

        Message<?> fromBlocked = arrival(blocked);
        assertThat(interceptor.beforeHandle(fromBlocked, null, null)).isSameAs(fromBlocked);
        verify(blockedUsers, never()).hasBlocked(any(), any());
    }

    @Test
    void islandAppearanceFramesAreMaskedPerViewerEvenWhenTheFilterIsOff() throws Exception {
        // 외양 사건(GROMO-2389)은 버리지 않고 가린다 — 필터 스위치와 무관하고 version 은 유지한다.
        when(blockedUsers.enabled()).thenReturn(false);
        UUID blocked = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        when(blockedUsers.hasBlockedUnfiltered(user, blocked)).thenReturn(true);
        var mapper = new tools.jackson.databind.ObjectMapper();

        var hidden = mapper.readTree((byte[]) interceptor.beforeHandle(appearance(blocked), null, null).getPayload());
        var look = hidden.get("payload").get("appearance");
        assertThat(look.get("head").isNull()).isTrue();
        assertThat(look.get("neck").isNull()).isTrue();
        assertThat(look.get("hull").asString()).isEqualTo("raft");
        assertThat(hidden.get("payload").get("version").asLong()).isEqualTo(4L);

        Message<?> visible = appearance(other);
        assertThat(interceptor.beforeHandle(visible, null, null)).isSameAs(visible);

        // 판정 불가는 가린다(fail-closed)
        UUID unknown = UUID.randomUUID();
        when(blockedUsers.hasBlockedUnfiltered(user, unknown)).thenThrow(new UpstreamUnavailableException());
        var failClosed = mapper.readTree((byte[]) interceptor.beforeHandle(appearance(unknown), null, null).getPayload());
        assertThat(failClosed.get("payload").get("appearance").get("head").isNull()).isTrue();
    }

    private Message<?> appearance(UUID owner) {
        return frame("socket", "/topic/islands/" + island + "/events",
                "{\"type\":\"member.appearance.updated\",\"payload\":{\"userId\":\"" + owner + "\","
                        + "\"appearance\":{\"clothes\":\"scarf\",\"decor\":null,\"head\":\"h\",\"neck\":\"n\","
                        + "\"shoes\":null,\"hull\":\"raft\",\"position\":\"back\"},\"version\":4}}");
    }

    private Message<?> arrival(UUID arriver) {
        return frame("socket", "/topic/islands/" + island + "/events",
                "{\"type\":\"island.member.arrived\",\"payload\":{\"userId\":\"" + arriver + "\"}}");
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

    // ── GROMO-2300 바다 방 ───────────────────────────────────────────────

    @Test
    void seaRoomFramesReachOnlyCurrentMembersAndFailClosed() {
        UUID mine = UUID.randomUUID();
        UUID left = UUID.randomUUID();
        UUID broken = UUID.randomUUID();
        when(seaRooms.isMember(user, mine)).thenReturn(true);
        when(seaRooms.isMember(user, broken)).thenThrow(new IllegalStateException("redis down"));

        Message<?> member = frame("socket", "/topic/sea/rooms/" + mine, "{}");
        assertThat(interceptor.beforeHandle(member, null, null)).isSameAs(member);
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/sea/rooms/" + left, "{}"), null, null))
                .as("Redis 에서 빠진 사람(다른 인스턴스의 정리)은 이 JVM 의 구독이 남아 있어도 못 받는다").isNull();
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/sea/rooms/" + broken, "{}"), null, null))
                .as("판정 불가는 보내지 않는다").isNull();
        assertThat(interceptor.beforeHandle(frame("socket", "/topic/sea/other", "{}"), null, null)).isNull();
        assertThat(meters.counter("sea.deliver.dropped", "reason", "not_member").count()).isEqualTo(1.0);
        assertThat(meters.counter("sea.deliver.dropped", "reason", "redis").count()).isEqualTo(1.0);
        verify(blockedUsers, never()).hasBlocked(any(), any());
    }

    @Test
    void seaRoomFramesRequireAValidToken() throws Exception {
        UUID mine = UUID.randomUUID();
        when(seaRooms.isMember(user, mine)).thenReturn(true);
        WebSocketSession socket = openSocket("socket");
        when(jwt.extractUserId("token")).thenReturn(Optional.empty());

        assertThat(interceptor.beforeHandle(frame("socket", "/topic/sea/rooms/" + mine, "{}"), null, null)).isNull();
        assertThat(meters.counter("sea.deliver.dropped", "reason", "jwt").count()).isEqualTo(1.0);
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

    // ── GROMO-2340 허용 결정 캐시 ──────────────────────────────────────────

    private final OutboundAuthzCache cache = new OutboundAuthzCache(
            java.util.concurrent.TimeUnit.SECONDS.toNanos(30), System::nanoTime, meters);
    private final OutboundMembershipSource membershipSource = mock(OutboundMembershipSource.class);
    private final ChatOutboundChannelInterceptor cached = new ChatOutboundChannelInterceptor(sessions, jwt, guard,
            delivery, new tools.jackson.databind.ObjectMapper(), blockedUsers, seaRooms, meters, cache, membershipSource);

    /** 캐시 켠 경로의 원본 만료 — 멤버십은 제한 없음, 차단은 같은 판정(hasBlocked 스텁)을 만료 제한 없이 돌려준다. */
    @BeforeEach
    void sourcedJudgments() {
        when(membershipSource.notAfter(any(), any())).thenReturn(Sourced.UNBOUNDED);
        when(blockedUsers.hasBlockedSourced(any(), any())).thenAnswer(invocation -> new Sourced<>(
                blockedUsers.hasBlocked(invocation.getArgument(0), invocation.getArgument(1)), Sourced.UNBOUNDED));
    }

    @Test
    void decisionIsNotCachedWhenTheMembershipSourceNoLongerSaysMember() {
        // 판정(관문) 뒤 원본이 비멤버 값으로 갈렸다 — OutboundMembershipSource 가 EXPIRED 를 주면 담지 않는다.
        when(membershipSource.notAfter(island, user)).thenReturn(Sourced.EXPIRED);
        UUID sender = UUID.randomUUID();
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();
        verify(guard, org.mockito.Mockito.times(2)).requireCanChat(island, user, "Bearer token");
    }

    @Test
    void allowedChatDecisionIsReusedButJwtIsStillCheckedEveryFrame() throws Exception {
        UUID sender = UUID.randomUUID();
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();
        // 상류(집중·멤버십·차단)는 첫 프레임 한 번만 — 둘째는 캐시 hit.
        verify(guard, org.mockito.Mockito.times(1)).requireCanChat(island, user, "Bearer token");
        verify(blockedUsers, org.mockito.Mockito.times(1)).hasBlocked(user, sender);
        verify(guard, org.mockito.Mockito.times(1)).requireNotFocusing(user); // hit 도 집중은 다시 본다
        // 다른 발신자는 차단 판정이 달라 따로 묻는다.
        assertThat(cached.beforeHandle(chat(UUID.randomUUID()), null, null)).isNotNull();
        verify(guard, org.mockito.Mockito.times(2)).requireCanChat(island, user, "Bearer token");

        // JWT 만료는 캐시와 무관하게 다음 프레임에서 잡혀 소켓을 닫는다.
        WebSocketSession socket = openSocket("socket");
        when(jwt.extractUserId("token")).thenReturn(Optional.empty());
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNull();
        verify(socket).close(CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
    }

    @Test
    void focusStartCutsOffChatEvenOnACacheHit() {
        // 서비스 규칙 2 — 구독 중 집중을 시작하면 그 순간부터 본문을 받지 않는다. 집중 시작은 무효화 사건이 없다.
        UUID sender = UUID.randomUUID();
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();
        doThrow(new IllegalStateException("focus")).when(guard).requireNotFocusing(user);
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNull();
    }

    @Test
    void rejectionsAreNeverCachedFailClosed() {
        UUID sender = UUID.randomUUID();
        doThrow(new UpstreamUnavailableException()).when(guard).requireCanChat(island, user, "Bearer token");
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNull();
        // 장애가 풀리면 다음 프레임이 다시 묻고 통과한다 — 거절이 담겼다면 계속 막혔을 것이다.
        org.mockito.Mockito.reset(guard);
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();

        UUID blocked = UUID.randomUUID();
        when(blockedUsers.hasBlocked(user, blocked)).thenReturn(true);
        assertThat(cached.beforeHandle(chat(blocked), null, null)).isNull();
        assertThat(cached.beforeHandle(chat(blocked), null, null)).isNull();
        verify(blockedUsers, org.mockito.Mockito.times(2)).hasBlocked(user, blocked);
    }

    @Test
    void evictionSendsTheNextFrameBackToTheSynchronousPath() {
        UUID sender = UUID.randomUUID();
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNotNull();
        doThrow(new IllegalStateException("not a member")).when(guard).requireCanChat(island, user, "Bearer token");
        assertThat(cached.beforeHandle(chat(sender), null, null)).as("캐시 hit — 아직 모른다").isNotNull();

        cache.evictUser(user); // island.members.updated(MEMBER_REMOVED)
        assertThat(cached.beforeHandle(chat(sender), null, null)).isNull();

        // 섬 소식도 같다 — 허용을 담고, 세션 종료가 지운다.
        org.mockito.Mockito.reset(guard);
        Message<?> arrival = arrival(sender);
        assertThat(cached.beforeHandle(arrival, null, null)).isSameAs(arrival);
        assertThat(cached.beforeHandle(arrival(sender), null, null)).isNotNull();
        verify(guard, org.mockito.Mockito.times(1)).requireMember(island, user, "Bearer token");
        cache.evictSession("socket");
        assertThat(cached.beforeHandle(arrival(sender), null, null)).isNotNull();
        verify(guard, org.mockito.Mockito.times(2)).requireMember(island, user, "Bearer token");
        assertThat(meters.counter("realtime.outbound.authz.cache", "result", "evict").count()).isEqualTo(2.0);
    }

    @Test
    void seaRoomMembershipIsReadEveryFrame() {
        // GROMO-2302 「전달 직전 재검사」 — 바다 방은 캐시하지 않는다.
        UUID room = UUID.randomUUID();
        when(seaRooms.isMember(user, room)).thenReturn(true);
        cached.beforeHandle(frame("socket", "/topic/sea/rooms/" + room, "{}"), null, null);
        cached.beforeHandle(frame("socket", "/topic/sea/rooms/" + room, "{}"), null, null);
        verify(seaRooms, org.mockito.Mockito.times(2)).isMember(user, room);
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

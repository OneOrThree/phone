package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.movement.MoveIntent;
import com.oneorthree.realtime.movement.MovementRooms;
import com.oneorthree.realtime.movement.RoomRuntime;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 이동 구독 수명 — 입장·퇴장·세션 교체·멤버십 재검사. 실제 {@link MovementRooms}·{@link MovementPublisher} 에
 * 즉시 완료하는 채널을 물려 틱을 손으로 돌린다(스케줄러 없음).
 */
class MovementSubscriptionListenerTest {

    private final RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
    private final ChatAccessGuard accessGuard = mock(ChatAccessGuard.class);
    private final ObjectMapper json = JsonMapper.builder().build();
    private final List<Message<?>> sent = new ArrayList<>();
    private final UUID island = UUID.randomUUID();
    private MovementRooms rooms;
    private MovementSubscriptionListener listener;
    private long tick;

    @BeforeEach
    void setUp() {
        MovementOutboundInterceptor completion = new MovementOutboundInterceptor();
        MovementPublisher publisher = new MovementPublisher(json, sessions, new SimpleMeterRegistry(),
                (message, timeout) -> {
                    sent.add(message);
                    completion.afterMessageHandled(message, null, null, null);
                    return true;
                });
        rooms = new MovementRooms(publisher, new SimpleMeterRegistry());
        listener = new MovementSubscriptionListener(rooms, publisher, sessions, accessGuard);
    }

    @Test
    @DisplayName("소켓 종료 정리가 지나간 뒤 순서 보존 큐에서 늦게 처리된 SUBSCRIBE 는 방에 들어가지 않는다(유령 actor 방지)")
    void lateSubscribeAfterSocketCleanupNeverJoins() {
        ChatPrincipal gone = connect("s1");
        sessions.closed("s1");
        listener.closed("s1"); // WebSocketConfig 가 소켓 기록을 지운 직후 부르는 순서 그대로.

        listener.preSend(subscribe("s1", "m", StompTopics.movementTopic(island), gone), null);

        assertThat(rooms.rooms()).as("입장이 큐에 들어갔다면 방이 생겼어야 한다").doesNotContainKey(island);

        ChatPrincipal alive = connect("s2");
        listener.preSend(subscribe("s2", "m", StompTopics.movementTopic(island), alive), null);
        tick();
        JsonNode first = bodiesFor("s2").get(0);
        assertThat(first.get("type").stringValue()).as("살아 있는 세션의 첫 메시지는 FullState").isEqualTo("FullState");
        assertThat(actorIds(first)).containsExactly(alive.userId().toString());
    }

    @Test
    @DisplayName("같은 사용자의 두 번째 세션이 구독하면 이전 세션엔 더 보내지 않고, 이전 세션이 끊겨도 actor 는 남는다(N6)")
    void secondSessionOfTheSameUserTakesOverTheActor() {
        ChatPrincipal phone = connect("phone");
        listener.preSend(subscribe("phone", "m", StompTopics.movementTopic(island), phone), null);
        tick();
        sent.clear();

        ChatPrincipal tablet = register("tablet", phone.userId());
        listener.preSend(subscribe("tablet", "m", StompTopics.movementTopic(island), tablet), null);
        tick();
        rooms.accept(island, phone.userId(), "tablet", new MoveIntent(1, 1, 39.5, 45.5));
        for (int i = 0; i < 5; i++) {
            tick(); // 한 칸 걷기 — 두 틱이면 도착한다. 남는 틱은 Arrived 가 나간 뒤의 조용한 틱이다.
        }

        assertThat(bodiesFor("phone")).as("교체된 세션엔 아무것도 가지 않는다").isEmpty();
        assertThat(bodiesFor("tablet")).extracting(b -> b.get("type").stringValue())
                .contains("FullState", "PathAccepted", "Arrived");

        sent.clear();
        sessions.closed("phone");
        listener.closed("phone");
        tick();
        assertThat(sent).as("뒷북 퇴장은 새 세션의 actor 를 지우지 않는다 — FullState 재전송도 없다").isEmpty();
    }

    @Test
    @DisplayName("주민 사건 재검사: 비멤버로 확정된 세션만 내보내고 더 보내지 않는다 — 상류 장애는 남긴다(N7)")
    void recheckRevokesOnlyConfirmedNonMembers() {
        ChatPrincipal member = connect("a");
        ChatPrincipal kicked = connect("b");
        ChatPrincipal unknown = connect("c");
        for (ChatPrincipal p : List.of(member, kicked, unknown)) {
            String session = sessionOf(p);
            listener.preSend(subscribe(session, "m", StompTopics.movementTopic(island), p), null);
        }
        tick();
        sent.clear();
        willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireMember(island, kicked.userId(), kicked.bearer());
        willThrow(new UpstreamUnavailableException())
                .given(accessGuard).requireMember(island, unknown.userId(), unknown.bearer());

        listener.recheckMembership(island);
        tick();

        assertThat(bodiesFor("b")).as("내보낸 세션엔 퇴장 FullState 도 가지 않는다").isEmpty();
        JsonNode toMember = bodiesFor("a").get(0);
        assertThat(toMember.get("type").stringValue()).isEqualTo("FullState");
        assertThat(actorIds(toMember)).containsExactlyInAnyOrder(member.userId().toString(),
                unknown.userId().toString());
    }

    @Test
    @DisplayName("movement UNSUBSCRIBE 는 퇴장이다 — 남은 사람이 FullState 를 받는다. snapshot 만 해지하면 방에 남는다")
    void unsubscribeOfMovementLeavesTheRoom() {
        ChatPrincipal stays = connect("a");
        ChatPrincipal leaves = connect("b");
        listener.preSend(subscribe("a", "m", StompTopics.movementTopic(island), stays), null);
        listener.preSend(subscribe("b", "m", StompTopics.movementTopic(island), leaves), null);
        listener.preSend(subscribe("b", "s", StompTopics.movementSnapshotTopic(island), leaves), null);
        tick();
        sent.clear();

        listener.preSend(unsubscribe("b", "s"), null);
        tick();
        assertThat(sent).as("snapshot 해지는 방 입장과 무관하다").isEmpty();

        listener.preSend(unsubscribe("b", "m"), null);
        tick();
        assertThat(actorIds(bodiesFor("a").get(0))).containsExactly(stays.userId().toString());
        assertThat(bodiesFor("b")).isEmpty();
    }

    private void tick() {
        tick++;
        for (RoomRuntime room : rooms.rooms().values()) {
            room.tick(tick);
        }
    }

    private ChatPrincipal connect(String sessionId) {
        return register(sessionId, UUID.randomUUID());
    }

    private ChatPrincipal register(String sessionId, UUID userId) {
        WebSocketSession socket = mock(WebSocketSession.class);
        when(socket.getId()).thenReturn(sessionId);
        when(socket.isOpen()).thenReturn(true);
        sessions.opened(socket);
        ChatPrincipal principal = new ChatPrincipal(userId, "Bearer " + sessionId);
        sessions.register(sessionId, principal);
        return principal;
    }

    private String sessionOf(ChatPrincipal principal) {
        return principal.bearer().substring("Bearer ".length());
    }

    private List<JsonNode> bodiesFor(String sessionId) {
        List<JsonNode> bodies = new ArrayList<>();
        for (Message<?> message : sent) {
            if (sessionId.equals(SimpMessageHeaderAccessor.getSessionId(message.getHeaders()))) {
                bodies.add(json.readTree((byte[]) message.getPayload()));
            }
        }
        return bodies;
    }

    private static List<String> actorIds(JsonNode fullState) {
        List<String> ids = new ArrayList<>();
        for (JsonNode actor : fullState.get("actors")) {
            ids.add(actor.get("userId").stringValue());
        }
        return ids;
    }

    private static Message<byte[]> subscribe(String sessionId, String subscriptionId, String destination,
            ChatPrincipal principal) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setSessionId(sessionId);
        accessor.setSubscriptionId(subscriptionId);
        accessor.setDestination(destination);
        accessor.setUser(principal);
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private static Message<byte[]> unsubscribe(String sessionId, String subscriptionId) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.UNSUBSCRIBE);
        accessor.setSessionId(sessionId);
        accessor.setSubscriptionId(subscriptionId);
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}

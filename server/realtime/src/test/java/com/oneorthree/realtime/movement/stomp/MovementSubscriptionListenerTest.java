package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
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
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willAnswer;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 이동 구독 수명 — 입장·퇴장·세션 교체·멤버십 재검사. 실제 {@link MovementRooms}·{@link MovementPublisher} 에
 * 즉시 완료하는 채널을 물려 틱을 손으로 돌린다. 재검사 스케줄러는 가짜다 — 예약된 작업을 한 단계씩 손으로
 * 돌려 «1초 뒤»·«16초 뒤»를 실제로 기다리지 않는다.
 */
class MovementSubscriptionListenerTest {

    private final RealtimeSessionRegistry sessions = new RealtimeSessionRegistry();
    private final ChatAccessGuard accessGuard = mock(ChatAccessGuard.class);
    private final JwtValidator jwtValidator = mock(JwtValidator.class);
    /** 소켓 종료를 맡는 워치독 실행기 — 테스트에선 받는 즉시 돌린다. */
    private final ScheduledExecutorService watchdog = mock(ScheduledExecutorService.class);
    private final ObjectMapper json = JsonMapper.builder().build();
    private final SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
    private final List<Message<?>> sent = new ArrayList<>();
    private final Map<String, WebSocketSession> sockets = new HashMap<>();
    private final UUID island = UUID.randomUUID();

    private final ScheduledExecutorService scheduler = mock(ScheduledExecutorService.class);
    private final Deque<Runnable> scheduled = new ArrayDeque<>();
    private final List<Long> delays = new ArrayList<>();
    private final List<ScheduledFuture<?>> futures = new ArrayList<>();

    private MovementRooms rooms;
    private MovementSubscriptionListener listener;
    private long tick;

    @BeforeEach
    void setUp() {
        given(scheduler.schedule(any(Runnable.class), anyLong(), any(TimeUnit.class))).willAnswer(invocation -> {
            scheduled.add(invocation.getArgument(0));
            delays.add(invocation.getArgument(1));
            ScheduledFuture<?> future = mock(ScheduledFuture.class);
            futures.add(future);
            return future;
        });
        willAnswer(invocation -> {
            ((Runnable) invocation.getArgument(0)).run();
            return null;
        }).given(watchdog).execute(any(Runnable.class));
        MovementPublisher publisher = publisher();
        rooms = new MovementRooms(publisher, meterRegistry);
        listener = listener(rooms, publisher);
    }

    private MovementSubscriptionListener listener(MovementRooms movementRooms, MovementPublisher publisher) {
        return new MovementSubscriptionListener(movementRooms, publisher, sessions, accessGuard, jwtValidator,
                meterRegistry, scheduler, watchdog);
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
        join("phone", phone);
        tick();
        sent.clear();

        ChatPrincipal tablet = register("tablet", phone.userId());
        join("tablet", tablet);
        tick();
        rooms.accept(island, phone.userId(), "tablet", new MoveIntent(1, 1, 39.5, 45.5));
        for (int i = 0; i < 5; i++) {
            tick(); // 한 칸 걷기 — 두 틱이면 도착한다. 남는 틱은 Arrived 가 나간 뒤의 조용한 틱이다.
        }

        assertThat(bodiesFor("phone")).as("교체된 세션엔 아무것도 가지 않는다").isEmpty();
        assertThat(types(bodiesFor("tablet"))).contains("FullState", "PathAccepted", "Arrived");

        sent.clear();
        sessions.closed("phone");
        listener.closed("phone");
        tick();
        assertThat(sent).as("뒷북 퇴장은 새 세션의 actor 를 지우지 않는다 — FullState 재전송도 없다").isEmpty();
    }

    @Test
    @DisplayName("movement UNSUBSCRIBE 는 퇴장이다 — 남은 사람이 FullState 를 받는다. snapshot 만 해지하면 방에 남는다")
    void unsubscribeOfMovementLeavesTheRoom() {
        ChatPrincipal stays = connect("a");
        ChatPrincipal leaves = connect("b");
        join("a", stays);
        join("b", leaves);
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

    // ── 강퇴 재검사(N7) — fail-closed + 백오프 재판정 ─────────────────────────

    @Test
    @DisplayName("MEMBER_REMOVED 를 받아 재판정을 예약한 순간부터 그 세션엔 아무것도 가지 않고, 통과 판정 뒤에야 재개한다")
    void deliveryStopsTheMomentTheRecheckIsScheduled() {
        ChatPrincipal stays = connect("a");
        ChatPrincipal target = connect("b");
        join("a", stays);
        join("b", target);
        listener.preSend(subscribe("a", "s", StompTopics.movementSnapshotTopic(island), stays), null);
        listener.preSend(subscribe("b", "s", StompTopics.movementSnapshotTopic(island), target), null);
        tick();
        sent.clear();

        listener.recheckMembership(island, target.userId()); // 예약만 — 재판정은 아직 돌지 않았다(앞선 조회에 밀린 상태)
        rooms.accept(island, stays.userId(), "a", new MoveIntent(1, 1, 39.5, 45.5));
        tick();

        assertThat(scheduled).as("재판정은 아직 실행 전이다").hasSize(1);
        assertThat(bodiesFor("b")).as("예약 순간부터 PathAccepted·Snapshot 모두 멈춘다").isEmpty();
        assertThat(types(bodiesFor("a"))).as("다른 사람 전달은 그대로다").contains("PathAccepted", "Snapshot");
        assertThat(meterRegistry.get("movement.recheck.suspended").counter().count()).isEqualTo(1.0);

        runNext(); // 통과 — 재개 + 그 세션 FullState 요청
        assertThat(bodiesFor("b")).as("재개만으로는 아무것도 쏟아지지 않는다 — 멈춘 동안의 사건은 버렸다").isEmpty();
        tick();

        List<String> resumed = types(bodiesFor("b"));
        assertThat(resumed.get(0)).as("재개 뒤 첫 메시지는 다시 맞추는 FullState").isEqualTo("FullState");
        assertThat(resumed).as("멈춘 동안 버린 PathAccepted 는 끝내 오지 않는다").doesNotContain("PathAccepted");
        assertThat(resumed).as("재개 뒤 사건은 다시 받는다").contains("Arrived", "Snapshot");
    }

    @Test
    @DisplayName("① 재검사 판정이 상류 장애로 실패하면 그 세션 전달을 멈춘 채 두고, 1초 뒤 재판정이 통과하면 FullState 로 다시 맞춘다")
    void failedRecheckSuspendsDeliveryUntilARetryAllows() {
        ChatPrincipal stays = connect("a");
        ChatPrincipal target = connect("b");
        join("a", stays);
        join("b", target);
        tick();
        sent.clear();
        willThrow(new UpstreamUnavailableException()).willDoNothing()
                .given(accessGuard).requireMemberUncached(island, target.userId(), target.bearer());

        listener.recheckMembership(island, target.userId());
        runNext(); // 사건 직후 판정 — 상류 장애
        rooms.accept(island, stays.userId(), "a", new MoveIntent(1, 1, 39.5, 45.5));
        tick();

        assertThat(delays).as("사건 직후 한 번, 실패하면 1초 뒤").containsExactly(0L, 1L);
        assertThat(bodiesFor("b")).as("판정을 못 내린 동안 탈락 후보에겐 아무것도 가지 않는다(fail-closed)").isEmpty();
        assertThat(types(bodiesFor("a"))).contains("PathAccepted");
        assertThat(meterRegistry.get("movement.recheck.suspended").counter().count()).isEqualTo(1.0);

        runNext(); // 1초 뒤 재판정 — 통과
        tick();

        assertThat(types(bodiesFor("b")).get(0)).as("재개 뒤 첫 메시지는 FullState").isEqualTo("FullState");
        assertThat(scheduled).as("통과하면 더 예약하지 않는다").isEmpty();
    }

    @Test
    @DisplayName("세션 토큰이 죽었으면 소속을 묻지 않고 1008 UNAUTHORIZED 로 닫는다 — 「소속 없음」으로 접혀 조용히 퇴장되지 않는다")
    void expiredTokenClosesWith1008InsteadOfAskingMembership() throws Exception {
        ChatPrincipal expired = connect("b");
        join("b", expired);
        given(jwtValidator.extractUserId("b")).willReturn(Optional.empty());

        listener.recheckMembership(island, null); // 옛 Data — 섬 전체 폴백
        runNext();

        verify(accessGuard, never()).requireMemberUncached(any(), any(), any());
        verify(sockets.get("b")).close(CloseStatus.POLICY_VIOLATION.withReason("UNAUTHORIZED"));
        assertThat(scheduled).as("같은 토큰으로 다시 물어도 같다 — 재시도하지 않는다").isEmpty();
    }

    @Test
    @DisplayName("② 재판정이 1·2·4·8·16초 뒤까지 모두 판정 불가면 세션을 1011 MEMBERSHIP_UNVERIFIED 로 닫는다")
    void exhaustedRetriesCloseTheSessionWith1011() throws Exception {
        ChatPrincipal target = connect("b");
        join("b", target);
        tick();
        sent.clear();
        willThrow(new UpstreamUnavailableException())
                .given(accessGuard).requireMemberUncached(island, target.userId(), target.bearer());

        listener.recheckMembership(island, target.userId());
        for (int attempt = 0; attempt < 6; attempt++) {
            runNext();
        }

        assertThat(delays).containsExactly(0L, 1L, 2L, 4L, 8L, 16L);
        assertThat(scheduled).as("예산을 다 쓰면 더 예약하지 않는다").isEmpty();
        verify(accessGuard, times(6)).requireMemberUncached(island, target.userId(), target.bearer());
        verify(sockets.get("b")).close(CloseStatus.SERVER_ERROR.withReason("MEMBERSHIP_UNVERIFIED"));
        tick();
        assertThat(bodiesFor("b")).as("닫힐 때까지도 받지 못한다").isEmpty();
    }

    @Test
    @DisplayName("③ 재판정 중 비멤버로 확정되면 방에서 내보낸다 — 남은 사람만 FullState 를 받는다")
    void notAMemberDuringRetryEvictsTheSession() {
        ChatPrincipal stays = connect("a");
        ChatPrincipal kicked = connect("b");
        join("a", stays);
        join("b", kicked);
        tick();
        sent.clear();
        willThrow(new UpstreamUnavailableException()).willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireMemberUncached(island, kicked.userId(), kicked.bearer());

        listener.recheckMembership(island, kicked.userId());
        runNext(); // 판정 불가 — 멈춤
        runNext(); // 비멤버 확정 — 퇴장
        tick();

        assertThat(actorIds(bodiesFor("a").get(0))).containsExactly(stays.userId().toString());
        assertThat(bodiesFor("b")).as("내보낸 세션엔 퇴장 FullState 도 가지 않는다").isEmpty();
        assertThat(scheduled).isEmpty();
    }

    @Test
    @DisplayName("재검사 대상은 사건의 memberUserId 세션뿐이다 — 없으면(옛 Data) 섬 전체")
    void recheckTargetsOnlyTheRemovedMember() {
        ChatPrincipal a = connect("a");
        ChatPrincipal b = connect("b");
        ChatPrincipal c = connect("c");
        join("a", a);
        join("b", b);
        join("c", c);

        listener.recheckMembership(island, b.userId());
        assertThat(scheduled).hasSize(1);
        runNext();

        verify(accessGuard).requireMemberUncached(island, b.userId(), b.bearer());
        verify(accessGuard, never()).requireMemberUncached(eq(island), eq(a.userId()), any());
        verify(accessGuard, never()).requireMemberUncached(eq(island), eq(c.userId()), any());

        listener.recheckMembership(island, null);
        assertThat(scheduled).as("memberUserId 가 없으면 섬 전체").hasSize(3);
    }

    @Test
    @DisplayName("새 사건은 진행 중인 재판정을 처음부터 다시 잡고(옛 예약 취소), 소켓 종료는 남은 예약을 취소한다")
    void newEventRestartsAndSocketCloseCancelsThePendingRecheck() {
        ChatPrincipal target = connect("b");
        join("b", target);
        willThrow(new UpstreamUnavailableException())
                .given(accessGuard).requireMemberUncached(island, target.userId(), target.bearer());
        listener.recheckMembership(island, target.userId());
        runNext(); // 판정 불가 — 1초 뒤 재판정 예약

        listener.recheckMembership(island, target.userId()); // 같은 세션의 새 사건
        verify(futures.get(1)).cancel(false);
        assertThat(delays).as("새 사건은 즉시, 처음부터").containsExactly(0L, 1L, 0L);
        runNext(); // 취소된 옛 재판정이 늦게 돌아도 아무것도 하지 않는다
        verify(accessGuard, times(1)).requireMemberUncached(island, target.userId(), target.bearer());

        sessions.closed("b");
        listener.closed("b");
        verify(futures.get(2)).cancel(false);
        runNext();
        verify(accessGuard, times(1)).requireMemberUncached(island, target.userId(), target.bearer());
    }

    @Test
    @DisplayName("처치(퇴장)가 던져도 재검사는 던지지 않고 그 세션 전달을 멈춘다 — 수신 트랜잭션을 되돌리지 않는다")
    void actionFailureNeverEscapesTheRecheck() {
        MovementRooms brokenRooms = mock(MovementRooms.class);
        willThrow(new IllegalStateException("퇴장 실패")).given(brokenRooms).leave(any(), any());
        MovementSubscriptionListener fragile = listener(brokenRooms, publisher());
        ChatPrincipal kicked = connect("b");
        fragile.preSend(subscribe("b", "m", StompTopics.movementTopic(island), kicked), null);
        willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireMemberUncached(island, kicked.userId(), kicked.bearer());

        assertThatCode(() -> fragile.recheckMembership(island, kicked.userId())).doesNotThrowAnyException();
        assertThatCode(this::runNext).doesNotThrowAnyException();
        assertThat(scheduled).isEmpty();
    }

    private MovementPublisher publisher() {
        MovementOutboundInterceptor completion = new MovementOutboundInterceptor();
        MessageChannel channel = (message, timeout) -> {
            sent.add(message);
            completion.afterMessageHandled(message, null, null, null);
            return true;
        };
        return new MovementPublisher(json, sessions, meterRegistry, channel);
    }

    private void runNext() {
        Runnable next = scheduled.poll();
        assertThat(next).as("예약된 재판정이 있어야 한다").isNotNull();
        next.run();
    }

    private void tick() {
        tick++;
        for (RoomRuntime room : rooms.rooms().values()) {
            room.tick(tick);
        }
    }

    private void join(String sessionId, ChatPrincipal principal) {
        listener.preSend(subscribe(sessionId, "m", StompTopics.movementTopic(island), principal), null);
    }

    private ChatPrincipal connect(String sessionId) {
        return register(sessionId, UUID.randomUUID());
    }

    private ChatPrincipal register(String sessionId, UUID userId) {
        WebSocketSession socket = mock(WebSocketSession.class);
        when(socket.getId()).thenReturn(sessionId);
        when(socket.isOpen()).thenReturn(true);
        sessions.opened(socket);
        sockets.put(sessionId, socket);
        ChatPrincipal principal = new ChatPrincipal(userId, "Bearer " + sessionId);
        sessions.register(sessionId, principal);
        given(jwtValidator.extractUserId(sessionId)).willReturn(Optional.of(userId)); // 토큰 = 세션 id, 살아 있다
        return principal;
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

    private static List<String> types(List<JsonNode> bodies) {
        List<String> types = new ArrayList<>();
        for (JsonNode body : bodies) {
            types.add(body.get("type").stringValue());
        }
        return types;
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

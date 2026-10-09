package com.oneorthree.realtime.movement.stomp;

import com.oneorthree.realtime.auth.ChatPrincipal;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.DomainException;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.config.RealtimeSessionRegistry;
import com.oneorthree.realtime.config.StompAuthChannelInterceptor;
import com.oneorthree.realtime.config.StompTopics;
import com.oneorthree.realtime.focus.IslandFocusSessions;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.oneorthree.realtime.message.service.ChatAccessGuard;
import com.oneorthree.realtime.movement.MoveIntent;
import com.oneorthree.realtime.movement.MovementEvent;
import com.oneorthree.realtime.movement.MovementRooms;
import com.oneorthree.realtime.movement.RoomRuntime;
import com.oneorthree.realtime.movement.Target;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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

    private MovementPublisher publisher;
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
        publisher = publisher();
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

    @Test
    @DisplayName("통과 판정의 재개와 새 사건의 멈춤이 같은 순간에 엇갈려도 새 판정 전엔 그 세션에 아무것도 가지 않는다")
    void allowedVerdictRacingANewEventNeverReopensBeforeTheNewJudgment() throws Exception {
        ChatPrincipal stays = connect("a");
        ChatPrincipal target = connect("b");
        join("a", stays);
        join("b", target);
        tick();
        sent.clear();
        MovementOutbox outbox = outboxOf("b");
        CountDownLatch judging = new CountDownLatch(1);
        CountDownLatch verdict = new CountDownLatch(1);
        willAnswer(invocation -> {
            judging.countDown();
            verdict.await(5, TimeUnit.SECONDS);
            return null; // 통과
        }).willDoNothing().given(accessGuard).requireMemberUncached(island, target.userId(), target.bearer());

        listener.recheckMembership(island, target.userId());
        Thread oldJudgment = new Thread(this::runNext, "old-judgment");
        oldJudgment.start();
        assertThat(judging.await(5, TimeUnit.SECONDS)).isTrue();
        Thread newEvent = new Thread(() -> listener.recheckMembership(island, target.userId()), "new-event");
        synchronized (outbox) {
            verdict.countDown();
            awaitBlocked(oldJudgment); // 통과로 판정하고 재개(outbox 잠금) 앞에 섰다
            newEvent.start();
            awaitBlocked(newEvent); // 새 사건의 멈춤이 바로 그 순간에 들어온다
        }
        oldJudgment.join(5_000);
        newEvent.join(5_000);

        rooms.accept(island, stays.userId(), "a", new MoveIntent(1, 1, 39.5, 45.5));
        tick();
        tick();
        assertThat(bodiesFor("b")).as("새 판정 전엔 옛 통과의 재개·FullState 도 새지 않는다").isEmpty();
        assertThat(scheduled).as("새 사건의 판정이 남아 있다").hasSize(1);

        runNext(); // 새 세대 판정 — 통과
        tick();
        assertThat(types(bodiesFor("b")).get(0)).isEqualTo("FullState");
    }

    @Test
    @DisplayName("강퇴 뒤 같은 id 로 다시 구독하면 남은 짝 구독 기록을 근거로 건너뛰지 않고 관문이 다시 판정한다 — 비멤버면 거절(ERROR)")
    void evictedSessionIsJudgedAgainWhenItResubscribesWithTheSameId() {
        StompAuthChannelInterceptor gate = gate();
        ChatPrincipal stays = connect("a");
        ChatPrincipal kicked = connect("b");
        join("a", stays);
        inbound(gate, raw("b", "m", StompTopics.movementTopic(island), kicked));
        inbound(gate, raw("b", "s", StompTopics.movementSnapshotTopic(island), kicked));
        verify(accessGuard, times(1)).requireMember(island, kicked.userId(), kicked.bearer()); // 짝 토픽은 이어받는다
        tick();
        willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireMemberUncached(island, kicked.userId(), kicked.bearer());
        listener.recheckMembership(island, kicked.userId());
        runNext(); // 비멤버 확정 — 퇴장
        tick();
        sent.clear();
        assertThat(sessions.subscriptionIdOf("b", StompTopics.movementTopic(island))).as("두 구독 기록도 지운다").isNull();
        assertThat(sessions.subscriptionIdOf("b", StompTopics.movementSnapshotTopic(island))).isNull();

        willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireMember(island, kicked.userId(), kicked.bearer());
        assertThatThrownBy(() -> inbound(gate, raw("b", "m", StompTopics.movementTopic(island), kicked)))
                .isInstanceOf(DomainException.class)
                .extracting(e -> ((DomainException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.NOT_A_MEMBER);
        verify(accessGuard, times(2)).requireMember(island, kicked.userId(), kicked.bearer()); // 다시 판정 1회
        tick();
        assertThat(sent).as("방에 다시 들어가지 않는다 — 남은 주민도 FullState 를 받지 않는다").isEmpty();
        assertThat(listener.holdsLiveOutbox("b", island)).isFalse();
    }

    @Test
    @DisplayName("관문이 살아 있던 outbox 로 판정을 이어받은 직후 강퇴가 끼어들면 그 구독은 새 outbox·actor 를 만들지 않는다")
    void subscribeInheritedJustBeforeEvictionNeverRejoins() {
        StompAuthChannelInterceptor gate = gate();
        ChatPrincipal stays = connect("a");
        ChatPrincipal kicked = connect("b");
        join("a", stays);
        inbound(gate, raw("b", "m", StompTopics.movementTopic(island), kicked));
        inbound(gate, raw("b", "s", StompTopics.movementSnapshotTopic(island), kicked));
        tick();
        // 같은 id 재전송 — 관문은 살아 있는 outbox 로 이어받아 통과시켰고, 처리기에 닿기 전에 강퇴가 끼어든다.
        Message<?> resent = gate.preSend(raw("b", "m", StompTopics.movementTopic(island), kicked), null);
        willThrow(new ChatException(ChatErrorCode.NOT_A_MEMBER))
                .given(accessGuard).requireMemberUncached(island, kicked.userId(), kicked.bearer());
        listener.recheckMembership(island, kicked.userId());
        runNext();
        tick();
        sent.clear();

        listener.preSend(resent, null);
        tick();

        verify(accessGuard, times(1)).requireMember(island, kicked.userId(), kicked.bearer());
        assertThat(sent).as("유령 actor 없음 — 남은 주민에게 FullState 도 가지 않는다").isEmpty();
        assertThat(listener.holdsLiveOutbox("b", island)).isFalse();
        assertThat(sessions.subscriptionIdOf("b", StompTopics.movementTopic(island)))
                .as("판정받은 구독으로 남지 않는다 — 다음 구독은 처음부터 판정").isNull();
    }

    @Test
    @DisplayName("③ 교체됐던 기기가 같은 구독 id 로 돌아오면 첫 reliable 은 자기 FullState 다 — 그 사이 나간 다른 사건은 버린다")
    void supersededDeviceReturningWithTheSameIdStartsFromItsOwnFullState() {
        ChatPrincipal phone = connect("phone");
        join("phone", phone);
        tick();
        ChatPrincipal tablet = register("tablet", phone.userId());
        join("tablet", tablet);
        tick();
        sent.clear();

        join("phone", phone); // 같은 id "m" — actor 를 되찾는다
        // 틱 스레드가 그 입장을 처리하기 전에 낸 사건(진행 중이던 이동의 도착 등)
        publisher.onEvent(island, new MovementEvent.Arrived(phone.userId(), 1, 99,
                new MovementEvent.Point(39.5, 45.5)), Target.ALL);
        tick();

        List<JsonNode> bodies = bodiesFor("phone");
        assertThat(types(bodies)).as("자기 FullState 전에 낸 Arrived 는 버린다").doesNotContain("Arrived");
        assertThat(types(bodies).get(0)).isEqualTo("FullState");
        assertThat(actorIds(bodies.get(0))).containsExactly(phone.userId().toString());
    }

    @Test
    @DisplayName("⑥ 다른 세션 입장의 전원 FullState 가 먼저 처리돼도 첫 메시지는 자기 actor 가 든 그 세션 한정 FullState 다")
    void firstFullStateAlwaysCarriesTheSubscribersOwnActor() {
        ChatPrincipal a = connect("a");
        join("a", a);
        tick();
        ChatPrincipal c = connect("c");
        ChatPrincipal b = connect("b");
        join("c", c); // 방 큐에서 b 보다 앞 — 그 입장의 전원 FullState 엔 b 가 없다
        join("b", b);
        tick();

        JsonNode first = bodiesFor("b").get(0);
        assertThat(first.get("type").stringValue()).isEqualTo("FullState");
        assertThat(actorIds(first)).contains(b.userId().toString());
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

    /** 실제 관문 — 이 처리기와 같은 레지스트리·멤버십 목을 쓴다. 시도 창은 늘 잡힌다. */
    @SuppressWarnings("unchecked")
    private StompAuthChannelInterceptor gate() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        given(redis.opsForValue()).willReturn(values);
        given(values.setIfAbsent(any(String.class), any(String.class), any(Duration.class))).willReturn(true);
        return new StompAuthChannelInterceptor(jwtValidator, accessGuard, sessions, mock(IslandFocusSessions.class),
                redis, listener);
    }

    /** 인바운드 체인 그대로 — 관문(거절이면 예외 = 실서비스의 ERROR 프레임 + 종료) 다음 이 처리기. */
    private void inbound(StompAuthChannelInterceptor gate, Message<?> frame) {
        listener.preSend(gate.preSend(frame, null), null);
    }

    private MovementOutbox outboxOf(String sessionId) {
        return publisher.outboxes(island).stream().filter(o -> o.sessionId().equals(sessionId)).findFirst()
                .orElseThrow();
    }

    /** 그 스레드가 모니터 앞에서 기다릴 때까지 — 5초 안에 안 서면 실패. */
    private static void awaitBlocked(Thread thread) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (thread.getState() != Thread.State.BLOCKED) {
            assertThat(System.nanoTime()).as("%s 가 잠금 앞에 서야 한다", thread.getName()).isLessThan(deadline);
            Thread.sleep(1);
        }
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

    /** 관문이 멤버십을 직접 판정해 통과시킨 SUBSCRIBE — 이 처리기만 도는 테스트가 쓴다. */
    private static Message<byte[]> subscribe(String sessionId, String subscriptionId, String destination,
            ChatPrincipal principal) {
        Message<byte[]> frame = raw(sessionId, subscriptionId, destination, principal);
        MessageHeaderAccessor.getAccessor(frame, StompHeaderAccessor.class)
                .setHeader(MovementSubscriptionListener.JUDGED, Boolean.TRUE);
        return frame;
    }

    /** 관문을 거치기 전의 SUBSCRIBE — 판정 표식은 관문이 붙인다. */
    private static Message<byte[]> raw(String sessionId, String subscriptionId, String destination,
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

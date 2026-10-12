package com.oneorthree.realtime.movement.stomp;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.util.MimeTypeUtils;
import org.springframework.web.socket.CloseStatus;

import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * 세션 하나 × 섬 하나의 이동 송신 큐 — reliable 덱 + 최신 Snapshot 슬롯 1개, <b>동시 in-flight 1건</b>(N3).
 *
 * <p>브로커를 쓰지 않고 {@code clientOutboundChannel} 에 세션별 MESSAGE 프레임을 직접 넣는다. 그 채널은 스레드
 * 풀이라 같은 세션의 프레임도 순서가 섞일 수 있으므로({@code setPreservePublishOrder} 미설정), 한 건을 보내면
 * 그 프레임의 처리 완료({@link MovementOutboundInterceptor} → {@link Ticket#release})를 받을 때까지 다음 건을
 * 보내지 않는다. 그 한 규칙으로 세 가지가 같이 풀린다.
 * <ul>
 *   <li><b>순서</b> — PathAccepted·Arrived 가 같은 틱에 나가도 앞뒤가 바뀌지 않는다.</li>
 *   <li><b>최신만</b> — 느린 구독자에게 밀린 Snapshot 은 슬롯 하나를 덮어쓴다. 보낼 차례가 오면 그때의
 *       최신 하나만 나간다.</li>
 *   <li><b>백프레셔</b> — reliable(FullState·PathAccepted·MoveRejected·Arrived)은 버리지 않고 쌓되
 *       {@link #RELIABLE_LIMIT} 를 넘으면 따라잡을 수 없는 구독자로 보고 소켓을 닫는다(재접속 = FullState 재동기화).</li>
 * </ul>
 * reliable 이 먼저, 그다음 슬롯이다 — 같은 틱의 PathAccepted 가 그 경로의 Snapshot 보다 먼저 도착해야 앱이
 * pathId 를 안다.
 *
 * <p><b>멈춤(suspend)</b> — 강퇴 재검사를 예약한 순간부터 통과로 판정될 때까지 이 세션엔 아무것도 보내지 않는다
 * (fail-closed). 멈춘 동안의 사건은 <b>쌓지 않고 버린다</b> — 재개 때 FullState 한 번으로 다시 맞추므로
 * ({@code awaitingFullState}) 밀린 사건을 한꺼번에 쏟지 않고, 큐 상한과 다툴 일도 없다. 멈추기 전에 채널에 넘긴
 * in-flight 한 건도 아웃바운드 실행기가 꺼낼 때 버린다({@link MovementOutboundInterceptor#beforeHandle}) — 그사이
 * 재개됐어도 버린다(프레임마다 만든 때의 게이트 세대를 지닌다). 소켓 쓰기가 이미 시작된 한 건만 나간다.
 * 판정·재시도·재동기화 요청은 {@link MovementSubscriptionListener} 가 한다.
 *
 * <p><b>첫 메시지는 이 세션만 겨냥한 FullState 다</b>({@code awaitingFullState}) — 구독 직후·재개 뒤·세션 교체에서
 * 돌아온 뒤. 남의 입장·퇴장이 낸 전원 FullState 는 이 세션의 join 이 방 큐에서 처리되기 전일 수 있어(자기 actor 가
 * 없다) 게이트를 열지 않는다. 그 세션 한정 FullState({@code requestFullState})는 방 큐 FIFO 상 join 뒤에 처리된다.
 * Snapshot 도 그 뒤부터다 — 게이트가 닫힌 동안의 Snapshot 은 슬롯에도 두지 않고 버린다(다음 틱이 또 준다). snapshot
 * 만 먼저 구독했거나 movement 를 해지한 세션은 FullState 가 올 길이 없으니 받지 않는다. 게이트는 멈춤·세션 교체·
 * movement 해지·새 구독 때 닫히고({@link #closeGate}), 닫힐 때마다 세대가 올라 이미 넘긴 프레임도 버려진다.
 *
 * <p><b>넘기기 실패는 fail-closed 다</b> — 채널이 프레임을 받지 않거나({@code send} 가 false 거나 던짐) 아웃바운드
 * 핸들러가 처리 중 던지면({@link Ticket#fail}) reliable 은
 * 그 세션이 받은 상태를 장담할 수 없으므로(첫 FullState 없이 게이트가 열리거나 PathAccepted 가 조용히 빠진다) outbox 를
 * 닫고 소켓을 1011 {@code MOVEMENT_SEND_FAILED} 로 닫는다 — 앱은 재연결·재구독으로 FullState 부터 다시 받는다.
 * Snapshot 은 버리고 다음 건으로 간다(다음 틱이 또 준다). 소켓 종료는 큐 초과와 같은 경로다(아래).
 *
 * <p><b>소켓 종료는 틱 스레드에서 하지 않는다</b> — 큐 초과·reliable 넘기기 실패는 종료를 <b>예약</b>만 하고, 완료
 * 통지(아웃바운드 실행기)나 워치독이 낸다. 틱 스레드에서 넘기기가 실패하면 기다릴 완료 통지가 없으므로 다음 워치독
 * (5초 안)이 낸다 — 그 사이엔 이미 닫힌 outbox 라 아무것도 보내지 않는다.
 *
 * <p><b>워치독</b> — 완료 통지가 끝내 오지 않는 프레임(표식 유실, 채널 구독자 0)이 있으면 그 세션 송신이 조용히
 * 굳는다. 워치독 실행기가 5초마다 {@link #sweep} 을 불러 {@link #STUCK_NANOS} 넘게 묶인 프레임을 끝난 것으로 친다
 * (덱이 찬 채 굳었으면 그때 종료 콜백도 나간다). 프레임마다 표식({@link Ticket})이 따로라, 워치독이 푼 뒤에 늦게 온
 * 옛 통지는 아무것도 풀지 않는다. 단, 워치독이 푼 프레임이 실제로는 아웃바운드 실행기에 밀려 있다가 다음 프레임보다
 * 늦게 나가면 그 세션의 순서가 한 번 어긋날 수 있다 — 완료 통지가 유실된 경우에만이고, 정상 경로는 통지가 다음 건을 푼다.
 *
 * <p>잠금은 이 객체 하나(짧다). <b>채널 전송·종료 콜백은 잠금 밖에서</b> 한다 — in-flight 표식이 동시 전송을 막으므로
 * 잠금이 필요 없고, 잠근 채 보내면 실행기가 작업을 바로 돌리는 경우(종료 중 거절 → 호출 스레드 실행) 완료 통지가
 * 같은 잠금을 다시 잡는다.
 */
final class MovementOutbox {

    /** 우리가 보낸 프레임의 표식 헤더 — 값은 그 프레임의 {@link Ticket}. 네이티브 헤더가 아니라 STOMP 선로에는 실리지 않는다. */
    static final String MARK = "movementOutbox";

    /** reliable 상한 — 이만큼 밀린 구독자는 따라잡을 수 없다. */
    static final int RELIABLE_LIMIT = 256;

    /**
     * 완료 통지 없이 이만큼 지나면 워치독이 그 프레임을 끝난 것으로 친다. Spring 의 세션 송신 시간 상한(10초)보다
     * 길다 — 정말 느린 소켓이면 워치독이 다음 프레임을 밀어 넣는 순간 Spring 이 그 세션을 닫는다.
     */
    static final long STUCK_NANOS = TimeUnit.SECONDS.toNanos(15);

    /** reliable 상한 초과 — 따라잡을 수 없는 구독자. */
    static final CloseStatus BACKPRESSURE = CloseStatus.POLICY_VIOLATION.withReason("MOVEMENT_BACKPRESSURE");

    /** reliable 프레임을 채널에 넘기지 못했다 — 받은 상태를 장담할 수 없어 끊고 처음부터 맞춘다. */
    static final CloseStatus SEND_FAILED = CloseStatus.SERVER_ERROR.withReason("MOVEMENT_SEND_FAILED");

    private static final Logger LOG = LoggerFactory.getLogger(MovementOutbox.class);

    private final MessageChannel channel;
    private final String sessionId;
    private final UUID userId;
    private final String movementDestination;
    private final String snapshotDestination;
    private final Consumer<CloseStatus> onClose;

    private final ArrayDeque<byte[]> reliable = new ArrayDeque<>();
    private byte[] latestSnapshot;
    private String movementSubscriptionId;
    private String snapshotSubscriptionId;
    /**
     * 첫 메시지는 이 세션만 겨냥한 FullState(자기 actor 포함)여야 한다(티켓 완료 조건 4) — 그 전의 다른 사건·전원
     * FullState·Snapshot 은 버린다. 처음부터 닫혀 있다(snapshot 을 먼저 구독해도 FullState 전엔 받지 않는다).
     */
    private boolean awaitingFullState = true;
    /** 같은 사용자의 다른 세션이 그 섬 actor 를 가져갔다 — 이 세션엔 더 보내지 않는다(N6). */
    private boolean superseded;
    /** 멤버십 재판정 중(예약부터 통과 판정까지) — 받는 사건을 버린다. */
    private boolean suspended;
    /**
     * 게이트를 닫을 때마다({@link #closeGate} — 멈춤·교체·movement 해지·새 구독) 1 씩 오른다. 프레임({@link Ticket})이 만든
     * 때의 값과 다르면 그 뒤 재개·재구독됐어도 버린다.
     */
    private int gateGeneration;
    /** 지금 나가 있는 프레임의 표식, 없으면 {@code null}. */
    private Ticket inFlight;
    private long inFlightSince;
    private boolean closed;
    /** 예약된 소켓 종료({@link #BACKPRESSURE}·{@link #SEND_FAILED}) — {@link #closeIfPending} 가 한 번 낸다. */
    private CloseStatus pendingClose;

    /**
     * @param onClose outbox 가 스스로 닫혀 소켓도 닫아야 할 때(큐 초과·reliable 넘기기 실패) <b>완료 통지나 워치독 때</b>
     *                (아웃바운드 실행기·워치독 스레드) 한 번 불린다 — 소켓 종료는 쓰기가 막힐 수 있어 틱 스레드에서 하지 않는다
     */
    MovementOutbox(MessageChannel channel, String sessionId, UUID userId, String movementDestination,
            String snapshotDestination, Consumer<CloseStatus> onClose) {
        this.channel = channel;
        this.sessionId = sessionId;
        this.userId = userId;
        this.movementDestination = movementDestination;
        this.snapshotDestination = snapshotDestination;
        this.onClose = onClose;
    }

    String sessionId() {
        return sessionId;
    }

    UUID userId() {
        return userId;
    }

    /**
     * reliable 사건 하나를 줄 세운다.
     *
     * @param resync 이 세션만 겨냥한 FullState 인가({@code Target.Only}) — 게이트({@code awaitingFullState})를 여는
     *               유일한 사건이다. 전원 FullState 는 {@code false} 로 온다
     * @return 줄 세운 직후 덱 깊이(측정용), 받을 구독이 없거나 버렸으면 0, 상한을 넘겼으면 -1
     */
    int enqueueReliable(byte[] payload, boolean resync) {
        Message<byte[]> next;
        int depth;
        synchronized (this) {
            if (closed || superseded || suspended || movementSubscriptionId == null
                    || (awaitingFullState && !resync)) {
                return 0;
            }
            if (reliable.size() >= RELIABLE_LIMIT) {
                // 더 받지 않는다. 덱이 찼다는 건 in-flight 한 건이 끝나지 않고 있다는 뜻이다 — 소켓 종료는 그 완료
                // 통지(또는 그게 굳었으면 워치독)가 낸다.
                pendingClose = BACKPRESSURE;
                closed = true;
                reliable.clear();
                latestSnapshot = null;
                return -1;
            }
            awaitingFullState = false;
            reliable.add(payload);
            depth = reliable.size();
            next = takeNextIfIdle();
        }
        transmit(next);
        return depth;
    }

    /**
     * 최신 Snapshot 으로 슬롯을 덮어쓴다. 자기 FullState 전이면 슬롯에도 두지 않고 버린다 — 입장 동기화보다 위치 갱신이
     * 먼저 가면 앱은 모르는 pathId 를 그리게 된다(N35). 다음 틱이 또 준다.
     *
     * @return 아직 못 보낸 이전 Snapshot 을 덮어썼으면 true(측정용)
     */
    boolean offerSnapshot(byte[] payload) {
        Message<byte[]> next;
        boolean replaced;
        synchronized (this) {
            if (closed || superseded || suspended || awaitingFullState || snapshotSubscriptionId == null) {
                return false;
            }
            replaced = latestSnapshot != null;
            latestSnapshot = payload;
            next = takeNextIfIdle();
        }
        transmit(next);
        return replaced;
    }

    /** 지금 in-flight 인 프레임이 끝난 것으로 친다 — 테스트가 «느린 구독자의 완료 통지»를 흉내 낼 때 쓴다. */
    void onSent() {
        Ticket current;
        synchronized (this) {
            current = inFlight;
        }
        release(current);
    }

    /**
     * 워치독 — {@link #STUCK_NANOS} 넘게 완료 통지가 없는 프레임을 끝난 것으로 치고(덱이 찬 채였으면 종료 콜백도
     * 이때 나간다), 기다릴 완료 통지가 없는 예약 종료(틱 스레드에서의 넘기기 실패)를 낸다. 워치독 실행기에서만 불린다.
     */
    void sweep(long nowNanos) {
        Ticket stuck = null;
        synchronized (this) {
            if (inFlight != null && nowNanos - inFlightSince >= STUCK_NANOS) {
                stuck = inFlight;
            }
        }
        if (stuck == null) {
            closeIfPending();
            return;
        }
        LOG.warn("이동 프레임 완료 통지가 {}초 넘게 없다 — 끝난 것으로 치고 다음 건으로 넘어간다",
                TimeUnit.NANOSECONDS.toSeconds(STUCK_NANOS));
        release(stuck);
    }

    /** 멈춘다 — 게이트를 닫는다(재개 때 FullState 로 재동기화). 재개는 게이트를 열지 않는다. */
    synchronized void suspend() {
        suspended = true;
        closeGate();
    }

    /** 재판정 통과 — 다시 받는다. 첫 reliable 은 호출자가 요청한 FullState 다({@code awaitingFullState}). */
    synchronized void resume() {
        suspended = false;
    }

    /**
     * movement 구독(= 방 입장). 새 구독이면 첫 reliable 은 FullState 를 기다린다 — 같은 id 의 재전송 SUBSCRIBE 는
     * 이미 받던 흐름을 끊지 않는다(교체됐다가 같은 id 로 돌아온 경우는 {@link #supersede} 가 이미 게이트를 닫아 뒀다).
     * 어느 쪽이든 이 세션이 actor 를 다시 가져온다(N6).
     */
    synchronized void subscribeMovement(String subscriptionId) {
        if (!subscriptionId.equals(movementSubscriptionId)) {
            movementSubscriptionId = subscriptionId;
            closeGate();
        }
        superseded = false;
    }

    synchronized void subscribeSnapshot(String subscriptionId) {
        snapshotSubscriptionId = subscriptionId;
    }

    /**
     * movement 해지 = 퇴장. 남은 snapshot 구독도 다시 movement 를 구독해 자기 FullState 를 받을 때까지 받지 않는다 —
     * 경로 사건(PathAccepted)이 끊긴 채 Snapshot 만 받으면 모르는 pathId 를 그린다. 이미 넘긴 Snapshot 도 버려진다(세대).
     *
     * @return 이 id 가 movement 구독이었으면 true — 호출자가 방에서 내보낸다
     */
    synchronized boolean unsubscribeMovement(String subscriptionId) {
        if (subscriptionId == null || !subscriptionId.equals(movementSubscriptionId)) {
            return false;
        }
        movementSubscriptionId = null;
        closeGate();
        return true;
    }

    synchronized void unsubscribeSnapshot(String subscriptionId) {
        if (subscriptionId != null && subscriptionId.equals(snapshotSubscriptionId)) {
            snapshotSubscriptionId = null;
            latestSnapshot = null;
        }
    }

    synchronized boolean hasMovement() {
        return movementSubscriptionId != null;
    }

    /** 이 id 로 그 토픽(snapshot 이면 Snapshot, 아니면 movement)을 들고 있는가 — 같은 구독의 재전송인지 가린다. */
    synchronized boolean holds(String subscriptionId, boolean snapshot) {
        return subscriptionId.equals(snapshot ? snapshotSubscriptionId : movementSubscriptionId);
    }

    synchronized boolean hasSubscriptions() {
        return movementSubscriptionId != null || snapshotSubscriptionId != null;
    }

    /** 닫혔다(해지·종료·강퇴·큐 초과) — 이 outbox 로는 더 보내지 않는다. */
    synchronized boolean isClosed() {
        return closed;
    }

    /**
     * 이 세션의 intent 를 방에 들여도 되는가 — 멈췄거나(강퇴 재검사 중) 닫혔거나 다른 기기에 actor 를 넘겼으면(N6)
     * 아니다. 교체된 옛 기기의 명령은 actor 에 붙지 않으면서 사용자 공용 토큰 버킷만 먹어 현재 기기 명령을 밀어낸다.
     */
    synchronized boolean acceptsIntents() {
        return !suspended && !closed && !superseded;
    }

    /**
     * 이미 채널에 넘긴 그 프레임을 실행기가 꺼낼 때 버려야 하는가({@link MovementOutboundInterceptor#beforeHandle}) —
     * 닫혔거나, 만든 뒤 게이트가 한 번이라도 닫혔다(멈춤·교체·movement 해지). 게이트가 닫힌 동안엔 프레임을 만들지 않으므로
     * 세대 비교가 «지금 닫힘»까지 덮는다. 재개·재구독 뒤라도 그 전 프레임이 자기 FullState 보다 먼저 나가면 안 된다.
     */
    private synchronized boolean isWithheld(Ticket ticket) {
        return closed || ticket.generation != gateGeneration;
    }

    /**
     * 게이트를 닫는다 — 다음 메시지는 이 세션만 겨냥한 FullState 부터다. 쌓인 reliable·Snapshot 을 버리고 세대를 올려
     * 이미 채널에 넘긴 프레임도 실행기가 꺼낼 때 버리게 한다. 잠금 안에서만 부른다.
     */
    private void closeGate() {
        awaitingFullState = true;
        gateGeneration++;
        reliable.clear();
        latestSnapshot = null;
    }

    /**
     * 같은 사용자의 다른 세션이 actor 를 가져갔다(N6) — 이 세션이 다시 movement 를 구독할 때까지 보내지 않는다.
     * 구독 자체(레지스트리 슬롯)는 그대로 둔다 — 그 기기가 다시 구독하면 actor 를 되찾는 자리이고, 해지나 연결
     * 종료 때 평소처럼 돌려받는다. 게이트도 여기서 닫는다 — 이미 넘긴 프레임도 그 기기엔 가지 않고, 같은 id 로 돌아와도
     * 그 사이 다른 사건이 자기 FullState 보다 먼저 나가지 않게.
     */
    synchronized void supersede() {
        superseded = true;
        closeGate();
    }

    /** 더 보내지 않는다. 이미 나간 in-flight 한 건의 완료 통지는 그대로 받아 아무것도 하지 않는다. */
    synchronized void close() {
        closed = true;
        reliable.clear();
        latestSnapshot = null;
    }

    /**
     * 그 표식의 프레임이 끝났다 — 지금 in-flight 인 바로 그 프레임일 때만 다음 건으로 간다. 완료 통지(아웃바운드
     * 실행기)·워치독·테스트에서만 불린다 — 틱 스레드가 아니므로 예약된 소켓 종료도 여기서 낸다.
     */
    private void release(Ticket ticket) {
        Message<byte[]> next;
        synchronized (this) {
            if (ticket != inFlight) {
                return; // 워치독이 이미 풀어 준 프레임의 늦은 통지
            }
            inFlight = null;
            next = takeNextIfIdle();
        }
        transmit(next);
        closeIfPending();
    }

    /**
     * 아웃바운드 핸들러가 그 프레임을 처리하다 던졌다 — 전해졌는지 알 수 없으니 넘기기 실패와 같다({@link #sendFailed}):
     * reliable 은 outbox 를 닫고 1011 종료, Snapshot 은 버리고 다음 건. 완료 통지(아웃바운드 스레드)에서만 불려 종료도
     * 바로 낸다.
     */
    private void handlerFailed(Ticket ticket) {
        transmit(sendFailed(ticket));
        closeIfPending();
    }

    /**
     * 예약된 소켓 종료를 한 번 낸다 — 나가 있는 프레임이 있으면 그 완료 통지(또는 워치독)를 기다린다. 틱 스레드에서
     * 부르지 않는다({@link #release}·{@link #handlerFailed}·{@link #sweep}).
     */
    private void closeIfPending() {
        CloseStatus status;
        synchronized (this) {
            if (pendingClose == null || inFlight != null) {
                return;
            }
            status = pendingClose;
            pendingClose = null;
        }
        try {
            onClose.accept(status);
        } catch (RuntimeException e) {
            LOG.warn("이동 세션 종료 처리 실패 — status={} reason={}", status, e.getClass().getSimpleName());
        }
    }

    /** 잠금 안에서만 부른다. 보낼 게 있고 in-flight 가 없으면 꺼내 in-flight 로 표시한다. */
    private Message<byte[]> takeNextIfIdle() {
        if (inFlight != null || closed) {
            return null;
        }
        Ticket ticket;
        Message<byte[]> next;
        if (!reliable.isEmpty()) {
            ticket = new Ticket(gateGeneration, false);
            next = frame(reliable.poll(), movementDestination, movementSubscriptionId, ticket);
        } else if (latestSnapshot != null) {
            ticket = new Ticket(gateGeneration, true);
            next = frame(latestSnapshot, snapshotDestination, snapshotSubscriptionId, ticket);
            latestSnapshot = null;
        } else {
            return null;
        }
        inFlight = ticket;
        inFlightSince = System.nanoTime();
        return next;
    }

    /**
     * 잠금 밖에서 보낸다. 채널이 받지 않으면(false·예외) 완료 통지가 오지 않는다 — Snapshot 은 버리고 다음 건을
     * 보내고, reliable 은 fail-closed 다({@link #sendFailed}). 소켓 종료는 여기서 내지 않는다(틱 스레드일 수 있다).
     */
    private void transmit(Message<byte[]> next) {
        while (next != null) {
            boolean handedOff;
            try {
                handedOff = channel.send(next);
            } catch (RuntimeException e) {
                LOG.debug("이동 프레임 넘기기 실패 — reason={}", e.getClass().getSimpleName());
                handedOff = false;
            }
            if (handedOff) {
                return;
            }
            next = sendFailed((Ticket) next.getHeaders().get(MARK));
        }
    }

    /**
     * 넘기지 못한 프레임 — Snapshot 이면 버리고 다음 건을 꺼낸다. reliable 이면 그 세션이 받은 상태를 장담할 수 없다
     * (첫 FullState 없이 게이트가 열리거나 PathAccepted 가 빠진다) — outbox 를 닫고 1011 종료를 예약한다.
     *
     * @return 이어서 보낼 프레임, 없으면 {@code null}
     */
    private synchronized Message<byte[]> sendFailed(Ticket ticket) {
        if (ticket != inFlight) {
            return null; // 이미 다른 경로(워치독)가 풀었다
        }
        inFlight = null;
        if (ticket.snapshot) {
            return takeNextIfIdle(); // 버린다 — 다음 틱이 또 준다
        }
        if (!closed) { // 이미 닫혔으면(해지·종료·큐 초과) 그쪽 정리를 따른다
            closed = true;
            pendingClose = SEND_FAILED;
            reliable.clear();
            latestSnapshot = null;
        }
        return null;
    }

    /**
     * 브로커를 거치지 않는 세션 직접 MESSAGE 프레임. 구독 id 가 있어야 클라이언트(stompjs)가 그 구독의 핸들러로
     * 보낸다 — 브로커가 하던 일을 여기서 한다({@code SimpleBrokerMessageHandler} 와 같은 헤더 모양).
     */
    private Message<byte[]> frame(byte[] payload, String destination, String subscriptionId, Ticket ticket) {
        SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId(sessionId);
        headers.setSubscriptionId(subscriptionId);
        headers.setDestination(destination);
        headers.setContentType(MimeTypeUtils.APPLICATION_JSON);
        headers.setHeader(MARK, ticket);
        headers.setLeaveMutable(true);
        return MessageBuilder.createMessage(payload, headers.getMessageHeaders());
    }

    /** 보낸 프레임 한 건의 표식 — 그 프레임의 완료 통지만 다음 건을 풀어 준다. */
    final class Ticket {

        /** 만든 때의 게이트 세대. */
        private final int generation;
        /** Snapshot 프레임인가 — 넘기기 실패 때 버리기만 한다(reliable 은 fail-closed). */
        private final boolean snapshot;

        private Ticket(int generation, boolean snapshot) {
            this.generation = generation;
            this.snapshot = snapshot;
        }

        /** {@link MovementOutboundInterceptor} 가 그 프레임 처리가 끝났을 때(또는 버렸을 때) 부른다. */
        void release() {
            MovementOutbox.this.release(this);
        }

        /** {@link MovementOutboundInterceptor} 가 그 프레임 처리 중 핸들러가 던졌을 때 부른다 — 넘기기 실패와 같다. */
        void fail() {
            handlerFailed(this);
        }

        /** 이 프레임을 넘긴 뒤 outbox 가 닫혔거나 게이트가 다시 닫힌 적이 있다(재개됐어도) — 실행기가 꺼낼 때 버린다. */
        boolean withheld() {
            return isWithheld(this);
        }
    }
}

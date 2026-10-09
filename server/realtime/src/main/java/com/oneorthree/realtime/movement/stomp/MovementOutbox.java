package com.oneorthree.realtime.movement.stomp;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.util.MimeTypeUtils;

import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

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
 * ({@code awaitingFullState}) 밀린 사건을 한꺼번에 쏟지 않고, 큐 상한과 다툴 일도 없다. 판정·재시도·재동기화 요청은
 * {@link MovementSubscriptionListener} 가 한다.
 *
 * <p><b>워치독</b> — 완료 통지가 끝내 오지 않는 프레임(표식 유실, 채널 구독자 0)이 있으면 그 세션 송신이 조용히
 * 굳는다. 워치독 실행기가 5초마다 {@link #sweep} 을 불러 {@link #STUCK_NANOS} 넘게 묶인 프레임을 끝난 것으로 친다
 * (덱이 찬 채 굳었으면 그때 종료 콜백도 나간다). 프레임마다 표식({@link Ticket})이 따로라, 워치독이 푼 뒤에 늦게 온
 * 옛 통지는 아무것도 풀지 않는다.
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

    private static final Logger LOG = LoggerFactory.getLogger(MovementOutbox.class);

    private final MessageChannel channel;
    private final String sessionId;
    private final UUID userId;
    private final String movementDestination;
    private final String snapshotDestination;
    private final Runnable onOverflow;

    private final ArrayDeque<byte[]> reliable = new ArrayDeque<>();
    private byte[] latestSnapshot;
    private String movementSubscriptionId;
    private String snapshotSubscriptionId;
    /** movement 구독 직후 첫 reliable 은 FullState 여야 한다(티켓 완료 조건 4) — 그 전의 다른 사건은 버린다. */
    private boolean awaitingFullState;
    /** 같은 사용자의 다른 세션이 그 섬 actor 를 가져갔다 — 이 세션엔 더 보내지 않는다(N6). */
    private boolean superseded;
    /** 멤버십 재판정 중(예약부터 통과 판정까지) — 받는 사건을 버린다. */
    private boolean suspended;
    /** 지금 나가 있는 프레임의 표식, 없으면 {@code null}. */
    private Ticket inFlight;
    private long inFlightSince;
    private boolean closed;
    private boolean overflowed;

    /**
     * @param onOverflow reliable 상한을 넘긴 뒤 <b>완료 통지나 워치독 때</b>(아웃바운드 실행기·이동 스케줄러 스레드)
     *                   한 번 불린다 — 소켓 종료는 쓰기가 막힐 수 있어 틱 스레드에서 하지 않는다
     */
    MovementOutbox(MessageChannel channel, String sessionId, UUID userId, String movementDestination,
            String snapshotDestination, Runnable onOverflow) {
        this.channel = channel;
        this.sessionId = sessionId;
        this.userId = userId;
        this.movementDestination = movementDestination;
        this.snapshotDestination = snapshotDestination;
        this.onOverflow = onOverflow;
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
     * @param fullState 이 사건이 FullState 인가 — 구독 직후엔 FullState 가 올 때까지 다른 사건을 버린다
     * @return 줄 세운 직후 덱 깊이(측정용), 받을 구독이 없거나 버렸으면 0, 상한을 넘겼으면 -1
     */
    int enqueueReliable(byte[] payload, boolean fullState) {
        Message<byte[]> next;
        int depth;
        synchronized (this) {
            if (closed || superseded || suspended || movementSubscriptionId == null
                    || (awaitingFullState && !fullState)) {
                return 0;
            }
            if (reliable.size() >= RELIABLE_LIMIT) {
                // 더 받지 않는다. 덱이 찼다는 건 in-flight 한 건이 끝나지 않고 있다는 뜻이다 — 소켓 종료는 그 완료
                // 통지(또는 그게 굳었으면 워치독)가 낸다.
                overflowed = true;
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
     * 최신 Snapshot 으로 슬롯을 덮어쓴다.
     *
     * @return 아직 못 보낸 이전 Snapshot 을 덮어썼으면 true(측정용)
     */
    boolean offerSnapshot(byte[] payload) {
        Message<byte[]> next;
        boolean replaced;
        synchronized (this) {
            if (closed || superseded || suspended || snapshotSubscriptionId == null) {
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
     * 워치독 — {@link #STUCK_NANOS} 넘게 완료 통지가 없는 프레임을 끝난 것으로 친다(덱이 찬 채였으면 종료 콜백도
     * 이때 나간다). 워치독 실행기에서만 불린다.
     */
    void sweep(long nowNanos) {
        Ticket stuck;
        synchronized (this) {
            if (inFlight == null || nowNanos - inFlightSince < STUCK_NANOS) {
                return;
            }
            stuck = inFlight;
        }
        LOG.warn("이동 프레임 완료 통지가 {}초 넘게 없다 — 끝난 것으로 치고 다음 건으로 넘어간다",
                TimeUnit.NANOSECONDS.toSeconds(STUCK_NANOS));
        release(stuck);
    }

    /**
     * 멈춘다 — 쌓인 reliable·Snapshot 을 버리고 다음 reliable 은 FullState 부터 받는다(재개 때 재동기화). 이미 나간
     * in-flight 한 건은 그대로 끝난다.
     */
    synchronized void suspend() {
        suspended = true;
        awaitingFullState = true;
        reliable.clear();
        latestSnapshot = null;
    }

    /** 재판정 통과 — 다시 받는다. 첫 reliable 은 호출자가 요청한 FullState 다({@code awaitingFullState}). */
    synchronized void resume() {
        suspended = false;
    }

    /**
     * movement 구독(= 방 입장). 새 구독이면 첫 reliable 은 FullState 를 기다린다 — 같은 id 의 재전송 SUBSCRIBE 는
     * 이미 받던 흐름을 끊지 않는다. 어느 쪽이든 이 세션이 actor 를 다시 가져온다(N6).
     */
    synchronized void subscribeMovement(String subscriptionId) {
        if (!subscriptionId.equals(movementSubscriptionId)) {
            movementSubscriptionId = subscriptionId;
            awaitingFullState = true;
        }
        superseded = false;
    }

    synchronized void subscribeSnapshot(String subscriptionId) {
        snapshotSubscriptionId = subscriptionId;
    }

    /** @return 이 id 가 movement 구독이었으면 true — 호출자가 방에서 내보낸다 */
    synchronized boolean unsubscribeMovement(String subscriptionId) {
        if (subscriptionId == null || !subscriptionId.equals(movementSubscriptionId)) {
            return false;
        }
        movementSubscriptionId = null;
        reliable.clear();
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

    synchronized boolean hasSubscriptions() {
        return movementSubscriptionId != null || snapshotSubscriptionId != null;
    }

    /** 닫혔다(해지·종료·퇴장·큐 초과) — 이 outbox 로는 더 보내지 않는다. */
    synchronized boolean isClosed() {
        return closed;
    }

    /**
     * 같은 사용자의 다른 세션이 actor 를 가져갔다(N6) — 이 세션이 다시 movement 를 구독할 때까지 보내지 않는다.
     * 구독 자체(레지스트리 슬롯)는 그대로 둔다 — 그 기기가 다시 구독하면 actor 를 되찾는 자리이고, 해지나 연결
     * 종료 때 평소처럼 돌려받는다.
     */
    synchronized void supersede() {
        superseded = true;
        reliable.clear();
        latestSnapshot = null;
    }

    /** 더 보내지 않는다. 이미 나간 in-flight 한 건의 완료 통지는 그대로 받아 아무것도 하지 않는다. */
    synchronized void close() {
        closed = true;
        reliable.clear();
        latestSnapshot = null;
    }

    /** 그 표식의 프레임이 끝났다 — 지금 in-flight 인 바로 그 프레임일 때만 다음 건으로 간다. */
    private void release(Ticket ticket) {
        Message<byte[]> next;
        boolean overflowNow;
        synchronized (this) {
            if (ticket != inFlight) {
                return; // 워치독이 이미 풀어 준 프레임의 늦은 통지
            }
            inFlight = null;
            overflowNow = overflowed;
            overflowed = false;
            next = takeNextIfIdle();
        }
        if (overflowNow) {
            try {
                onOverflow.run();
            } catch (RuntimeException e) {
                LOG.warn("이동 송신 큐 초과 처리 실패 — reason={}", e.getClass().getSimpleName());
            }
        }
        transmit(next);
    }

    /** 잠금 안에서만 부른다. 보낼 게 있고 in-flight 가 없으면 꺼내 in-flight 로 표시한다. */
    private Message<byte[]> takeNextIfIdle() {
        if (inFlight != null || closed) {
            return null;
        }
        Ticket ticket = new Ticket();
        Message<byte[]> next;
        if (!reliable.isEmpty()) {
            next = frame(reliable.poll(), movementDestination, movementSubscriptionId, ticket);
        } else if (latestSnapshot != null) {
            next = frame(latestSnapshot, snapshotDestination, snapshotSubscriptionId, ticket);
            latestSnapshot = null;
        } else {
            return null;
        }
        inFlight = ticket;
        inFlightSince = System.nanoTime();
        return next;
    }

    /** 잠금 밖에서 보낸다. 채널이 받지 않았으면 완료 통지가 오지 않으므로 직접 다음 건으로 넘어간다. */
    private void transmit(Message<byte[]> next) {
        if (next == null) {
            return;
        }
        boolean handedOff;
        try {
            handedOff = channel.send(next);
        } catch (RuntimeException e) {
            LOG.debug("이동 프레임 전송 실패 — 다음 건으로 넘어간다. reason={}", e.getClass().getSimpleName());
            handedOff = false;
        }
        if (!handedOff) {
            release((Ticket) next.getHeaders().get(MARK));
        }
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

        /** {@link MovementOutboundInterceptor} 가 그 프레임 처리가 끝났을 때 부른다. */
        void release() {
            MovementOutbox.this.release(this);
        }
    }
}

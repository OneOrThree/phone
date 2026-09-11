package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.group.event.GroupBetSessionClosedEvent;
import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.notification.service.BetWonNotificationService;
import com.oneorthree.phone.notification.service.ChallengeCreatedNotificationService;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Clock;

/**
 * 요청형 알림 사건을 <b>원 도메인 트랜잭션 안에서</b> outbox 에 적는다 (A21 · 계약 §3).
 *
 * <h2>{@code AFTER_COMMIT} 이 남기는 유실 구간</h2>
 * 구 리스너 넷은 전부 {@code @TransactionalEventListener(AFTER_COMMIT)} + {@code @Async} 다.
 * 커밋은 끝났는데 리스너가 돌기 전에 프로세스가 죽으면 <b>그 알림은 아무 흔적 없이 사라진다</b> —
 * 도메인 데이터는 남았는데 알림만 없어서, 나중에 어디를 봐도 「나갔어야 했다」를 알 수 없다.
 * 내기 결과만 15분 재훑기가 회수하고, 친구 요청·챌린지 개설·승리 확정은 회수 경로 자체가 없다.
 *
 * <p><b>{@code afterCommit} 안에서 outbox 만 적는 것으로도 안 된다</b> — 그 시점의 트랜잭션은
 * 이미 커밋됐으므로 새 트랜잭션이 열리고, 그 새 트랜잭션이 실패하면 같은 유실이 그대로 남는다.
 * 원자성은 <b>같은 트랜잭션</b>에서만 나온다.
 *
 * <h2>그래서 {@code BEFORE_COMMIT} 이다</h2>
 * 이 단계는 <b>발행 트랜잭션 안에서 동기로</b> 돈다. 그래서 {@code OutboxCommandPort.append}
 * 의 {@code MANDATORY} 가 성립하고, 도메인이 롤백되면 사건도 함께 사라진다(반대 방향 유실도 없다).
 *
 * <p>대가는 <b>여기서 나는 예외가 커밋을 되돌린다</b>는 것이다. 그건 의도다 — 사건을 적지 못했다면
 * 그 도메인 변경은 「알림이 나갈 것」이라는 약속을 지킬 수 없고, 조용히 커밋하면 유실이 된다.
 * 구 경로가 예외를 삼켰던 것은 «이미 커밋된 뒤»라 되돌릴 수가 없어서였다.
 *
 * <h2>구 경로와 동시에 돌지 않는다</h2>
 * {@code LEGACY} 모드에서는 여기서 아무 일도 하지 않고({@link NotificationDispatcher#enqueueOnly}
 * 가 바로 돌아온다), {@code OUTBOX} 모드에서는 구 {@code AFTER_COMMIT} 리스너들이 각자 건너뛴다.
 * 두 경로가 겹쳐 돌면 같은 사건이 FCM 으로도 가고 Kafka 로도 간다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationRequestOutboxListener {

    private final NotificationDispatcher notificationDispatcher;
    private final BetEventNotificationService betEventNotificationService;
    private final BetWonNotificationService betWonNotificationService;
    private final ChallengeCreatedNotificationService challengeCreatedNotificationService;
    private final FriendNotificationService friendNotificationService;
    private final Clock clock;

    /**
     * 회차 종료 — 참가자 전원의 결과·환불 사건을 적는다.
     *
     * @param event 종료된 회차
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onSessionClosed(GroupBetSessionClosedEvent event) {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        betEventNotificationService.notifySessionClosed(event.sessionId(), clock.instant());
    }

    /**
     * 개인 승리 조기 확정 — 본인 1명.
     *
     * @param event 승리가 확정된 참가자
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onBetWon(GroupBetWonEvent event) {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        betWonNotificationService.enqueueWonNotification(event);
    }

    /**
     * 챌린지 개설 — 개설자를 뺀 그룹원 전원.
     *
     * @param event 개설된 챌린지
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onChallengeCreated(GroupChallengeCreatedEvent event) {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        challengeCreatedNotificationService.enqueueCreatedNotifications(event);
    }

    /**
     * 친구 요청 도착 — 받은 쪽.
     *
     * @param event 방금 만들어진 친구 요청
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onFriendRequestSent(FriendRequestSentEvent event) {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        friendNotificationService.enqueueFriendRequestNotification(event.requestId(),
                event.receiverUserId(), event.senderUserId());
    }

    /**
     * 친구 요청 수락 — 먼저 요청했던 쪽.
     *
     * @param event 방금 성사된 수락
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        friendNotificationService.enqueueFriendAcceptedNotification(event.requesterUserId(),
                event.accepterUserId());
    }
}

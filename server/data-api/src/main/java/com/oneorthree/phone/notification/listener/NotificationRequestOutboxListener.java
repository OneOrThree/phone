package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.group.event.GroupBetSessionClosedEvent;
import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.notification.producer.NotificationDispatchOutcome;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.notification.service.BetWonNotificationService;
import com.oneorthree.phone.notification.service.ChallengeCreatedNotificationService;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.ArrayList;
import java.util.List;

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
 * <h2>한 트랜잭션의 사건은 모아서 한 번에 적는다 (GROMO-893)</h2>
 * 사건 하나가 수신자 USER 행을 트랜잭션 끝까지 잠근다. 챌린지 삭제는 OPEN 회차마다
 * {@code GroupBetSessionClosedEvent} 를 따로 내므로, 사건마다 곧장 적으면 회차 A 의 참가자를 잠근 뒤 회차
 * B 의 참가자를 잠그는 식으로 <b>트랜잭션 전체</b>의 잠금 순서가 회차 순서에 끌려간다 — 회차 안에서만
 * 정렬해도 같은 사용자를 다른 순서로 잡는 트랜잭션과 교착한다.
 *
 * <p>그래서 두 단계로 나눈다. 모든 사건의 {@code BEFORE_COMMIT} 동기화는 발행 시점에 등록되고 커밋 직전에
 * {@code @Order} 순으로 정렬돼 돈다. ① 가장 앞({@link Ordered#HIGHEST_PRECEDENCE})에서 사건을 이
 * 트랜잭션의 대기열에 담기만 하고, ② 가장 뒤({@link Ordered#LOWEST_PRECEDENCE})의 첫 호출이 대기열 전체를
 * 판정해 수신자 <b>합집합</b>을 정본 순서로 잠근 뒤 적는다. 이후 호출은 빈 대기열을 보고 돌아간다.
 *
 * <h2>구 경로와 동시에 돌지 않는다</h2>
 * {@code LEGACY} 모드에서는 여기서 아무 일도 하지 않고, {@code OUTBOX} 모드에서는 구
 * {@code AFTER_COMMIT} 리스너들이 각자 건너뛴다. 두 경로가 겹쳐 돌면 같은 사건이 FCM 으로도 가고 Kafka 로도 간다.
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

    /** @param event 종료된 회차 — 대기열에 담는다 */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectSessionClosed(GroupBetSessionClosedEvent event) {
        collect(event);
    }

    /** @param event 승리가 확정된 참가자 — 대기열에 담는다 */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectBetWon(GroupBetWonEvent event) {
        collect(event);
    }

    /** @param event 개설된 챌린지 — 대기열에 담는다 */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectChallengeCreated(GroupChallengeCreatedEvent event) {
        collect(event);
    }

    /** @param event 방금 만들어진 친구 요청 — 대기열에 담는다 */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectFriendRequestSent(FriendRequestSentEvent event) {
        collect(event);
    }

    /** @param event 방금 성사된 수락 — 대기열에 담는다 */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        collect(event);
    }

    /**
     * 회차 종료 — 참가자 전원의 결과·환불 사건. 이 트랜잭션의 대기열 전체와 함께 적는다.
     *
     * @param event 종료된 회차
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onSessionClosed(GroupBetSessionClosedEvent event) {
        flush();
    }

    /**
     * 개인 승리 조기 확정 — 본인 1명.
     *
     * @param event 승리가 확정된 참가자
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onBetWon(GroupBetWonEvent event) {
        flush();
    }

    /**
     * 챌린지 개설 — 개설자를 뺀 그룹원 전원.
     *
     * @param event 개설된 챌린지
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onChallengeCreated(GroupChallengeCreatedEvent event) {
        flush();
    }

    /**
     * 친구 요청 도착 — 받은 쪽.
     *
     * @param event 방금 만들어진 친구 요청
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onFriendRequestSent(FriendRequestSentEvent event) {
        flush();
    }

    /**
     * 친구 요청 수락 — 먼저 요청했던 쪽.
     *
     * @param event 방금 성사된 수락
     */
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        flush();
    }

    private void collect(Object event) {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        PendingEvents.current().events.add(event);
    }

    /** 대기열 전체를 판정하고 수신자 합집합을 한 번에 적는다 — 두 번째 호출부터는 빈 대기열이다. */
    private void flush() {
        if (!notificationDispatcher.isOutboxMode()) {
            return;
        }
        List<Object> events = PendingEvents.current().drain();
        if (events.isEmpty()) {
            return;
        }
        List<NotificationRequest> requests = new ArrayList<>();
        for (Object event : events) {
            requests.addAll(requestsOf(event));
        }
        long queued = notificationDispatcher.enqueueAll(requests).stream()
                .filter(NotificationDispatchOutcome.QUEUED::equals)
                .count();
        log.debug("요청형 알림 사건 적재 — 도메인 사건 {}건, 요청 {}건, 신규 {}건", events.size(), requests.size(), queued);
    }

    private List<NotificationRequest> requestsOf(Object event) {
        if (event instanceof GroupBetSessionClosedEvent closed) {
            return betEventNotificationService.closedSessionRequests(closed.sessionId());
        }
        if (event instanceof GroupBetWonEvent won) {
            return List.of(betWonNotificationService.wonRequest(won));
        }
        if (event instanceof GroupChallengeCreatedEvent created) {
            return challengeCreatedNotificationService.createdRequests(created);
        }
        if (event instanceof FriendRequestSentEvent sent) {
            return friendNotificationService.friendRequestRequest(sent.requestId(), sent.receiverUserId(),
                    sent.senderUserId()).stream().toList();
        }
        if (event instanceof FriendRequestAcceptedEvent accepted) {
            return friendNotificationService.friendAcceptedRequest(accepted.requesterUserId(),
                    accepted.accepterUserId()).stream().toList();
        }
        throw new IllegalStateException("모르는 요청형 알림 사건입니다: " + event.getClass().getName());
    }

    /**
     * 한 트랜잭션에서 아직 적지 않은 도메인 사건.
     *
     * <p>리소스 맵이 아니라 동기화 목록에 둔다 — {@code REQUIRES_NEW} 로 열린 안쪽 트랜잭션(정산은
     * {@code REQUIRES_NEW})이 바깥 트랜잭션의 대기열을 보면 안 되는데, 동기화 목록만 트랜잭션마다 중단·재개된다.
     */
    private static final class PendingEvents implements TransactionSynchronization {

        private final List<Object> events = new ArrayList<>();

        static PendingEvents current() {
            for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
                if (synchronization instanceof PendingEvents pending) {
                    return pending;
                }
            }
            PendingEvents pending = new PendingEvents();
            TransactionSynchronizationManager.registerSynchronization(pending);
            return pending;
        }

        List<Object> drain() {
            List<Object> drained = List.copyOf(events);
            events.clear();
            return drained;
        }
    }
}

package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
import com.oneorthree.phone.group.event.IslandKickedEvent;
import com.oneorthree.phone.notification.producer.NotificationOutboxProducer;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import com.oneorthree.phone.notification.service.IslandKickNotificationService;
import com.oneorthree.phone.notification.service.MainIslandNotificationService;
import lombok.RequiredArgsConstructor;
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
 * 친구·메인 섬 이전·강퇴 사건을 커밋 직전에 outbox에 기록한다.
 * 한 트랜잭션의 사건을 먼저 모아 모든 수신자 잠금을 정본 순서로 잡는다.
 * 요청 조립과 적기에서 새 도메인 사건을 발행하지 않아야 한다.
 */
@Component
@RequiredArgsConstructor
public class NotificationRequestOutboxListener {
    private final NotificationOutboxProducer producer;
    private final FriendNotificationService friendNotificationService;
    private final MainIslandNotificationService mainIslandNotificationService;
    private final IslandKickNotificationService islandKickNotificationService;

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectFriendRequestSent(FriendRequestSentEvent event) {
        PendingEvents.current().events.add(event);
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        PendingEvents.current().events.add(event);
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectMainIslandTransferred(MainIslandTransferredEvent event) {
        PendingEvents.current().events.add(event);
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onFriendRequestSent(FriendRequestSentEvent event) {
        flush();
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        flush();
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onMainIslandTransferred(MainIslandTransferredEvent event) {
        flush();
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public void collectIslandKicked(IslandKickedEvent event) {
        PendingEvents.current().events.add(event);
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Order(Ordered.LOWEST_PRECEDENCE)
    @Transactional(propagation = Propagation.MANDATORY)
    public void onIslandKicked(IslandKickedEvent event) {
        flush();
    }

    private void flush() {
        List<Object> events = PendingEvents.current().drain();
        if (events.isEmpty()) {
            return;
        }
        List<NotificationRequest> requests = new ArrayList<>();
        for (Object event : events) {
            requests.addAll(requestsOf(event));
        }
        producer.appendAll(requests);
    }

    private List<NotificationRequest> requestsOf(Object event) {
        if (event instanceof FriendRequestSentEvent sent) {
            return friendNotificationService.friendRequestRequest(sent.requestId(), sent.receiverUserId(),
                    sent.senderUserId()).stream().toList();
        }
        if (event instanceof FriendRequestAcceptedEvent accepted) {
            return friendNotificationService.friendAcceptedRequest(accepted.requesterUserId(),
                    accepted.accepterUserId()).stream().toList();
        }
        if (event instanceof MainIslandTransferredEvent transferred) {
            return mainIslandNotificationService.transferredRequest(transferred).stream().toList();
        }
        if (event instanceof IslandKickedEvent kicked) {
            return islandKickNotificationService.kickedRequest(kicked).stream().toList();
        }
        throw new IllegalStateException("모르는 요청형 알림 사건입니다: " + event.getClass().getName());
    }

    /** 트랜잭션 동기화 목록에 보관해 REQUIRES_NEW의 대기열도 독립시킨다. */
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

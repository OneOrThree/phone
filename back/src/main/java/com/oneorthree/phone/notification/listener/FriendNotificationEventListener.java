package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 친구 도메인 이벤트 → 푸시 발송 어댑터 (GROMO-1090).
 *
 * <p><b>{@code AFTER_COMMIT} 이 이 클래스의 존재 이유다.</b> 친구 요청/수락이 롤백되는데 알림만
 * 나가는 일을 막는다. 커밋되지 않은 트랜잭션의 이벤트는 이 리스너에 도달하지 않는다.
 *
 * <p>발송 본체를 {@link FriendNotificationService} 로 분리한 이유는 두 가지다.
 * ① 새 트랜잭션({@code REQUIRES_NEW})은 프록시를 거쳐야 걸리므로 같은 빈 안에서 자기 호출로는
 * 열리지 않는다. ② 예외 격리가 트랜잭션 프록시 <b>바깥</b>에 있어야 한다 — {@code afterCommit}
 * 콜백에서 던진 예외는 커밋을 호출한 쪽(= 친구 요청 API)까지 전파되므로, 알림 실패가 이미 커밋된
 * 친구 요청을 500 으로 뒤집게 놔둘 수 없다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FriendNotificationEventListener {

    private final FriendNotificationService friendNotificationService;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onFriendRequestSent(FriendRequestSentEvent event) {
        try {
            friendNotificationService.notifyFriendRequest(event.receiverUserId(), event.senderUserId());
        } catch (Exception e) {
            log.warn("친구 요청 푸시 실패 — receiverUserId={}", event.receiverUserId(), e);
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        try {
            friendNotificationService.notifyFriendAccepted(event.requesterUserId(), event.accepterUserId());
        } catch (Exception e) {
            log.warn("친구 수락 푸시 실패 — requesterUserId={}", event.requesterUserId(), e);
        }
    }
}

package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.config.NotificationAsyncConfig;
import com.oneorthree.phone.notification.service.FriendNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 친구 도메인 이벤트 → 푸시 발송 어댑터 (GROMO-1090).
 *
 * <p><b>{@code AFTER_COMMIT} 이 이 클래스의 존재 이유다.</b> 친구 요청/수락이 롤백되는데 알림만
 * 나가는 일을 막는다. 커밋되지 않은 트랜잭션의 이벤트는 이 리스너에 도달하지 않는다.
 *
 * <p><b>{@code @Async} 는 선택이 아니다.</b> {@code afterCommit} 콜백은 바깥 트랜잭션의 JDBC 리소스가
 * 정리되기 전에 실행된다. 요청 스레드에서 그대로 발송하면 발송용 새 트랜잭션이 두 번째 커넥션을
 * 요구해, 요청 하나가 커넥션 두 개를 물고 동시 요청이 풀 크기에 닿는 순간 서로를 기다리며 멈춘다
 * (@codex 리뷰 P1 — {@code FriendPushConnectionUsageTest} 가 풀 크기 1로 실증). 발송을 다른
 * 스레드로 넘기면 바깥 커넥션이 먼저 반납되고, FCM 왕복 지연도 API 응답에서 빠진다.
 * 풀은 챌린지 개설 알림(1089)이 먼저 만든 {@code pushExecutor} 를 공유한다 — 같은 관심사다.
 *
 * <p>발송 본체를 {@link FriendNotificationService} 로 분리한 이유는 두 가지다.
 * ① 새 트랜잭션({@code REQUIRES_NEW})은 프록시를 거쳐야 걸리므로 같은 빈 안에서 자기 호출로는
 * 열리지 않는다. ② 예외 격리가 트랜잭션 프록시 <b>바깥</b>에 있어야 한다 — 비동기 전환 전에는
 * {@code afterCommit} 예외가 커밋 호출측(= 친구 요청 API)까지 전파됐다. 지금은 예외가 발송 스레드를
 * 넘지 못하지만, catch 는 그대로 둔다: 삼킨 예외를 한국어 로그로 남기는 편이 기본 비동기 예외
 * 핸들러에 맡기는 것보다 낫고, 동기로 되돌리는 변경이 있어도 안전판이 남는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FriendNotificationEventListener {

    private final FriendNotificationService friendNotificationService;

    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onFriendRequestSent(FriendRequestSentEvent event) {
        try {
            friendNotificationService.notifyFriendRequest(
                    event.requestId(), event.receiverUserId(), event.senderUserId());
        } catch (Exception e) {
            log.warn("친구 요청 푸시 실패 — receiverUserId={}", event.receiverUserId(), e);
        }
    }

    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onFriendRequestAccepted(FriendRequestAcceptedEvent event) {
        try {
            friendNotificationService.notifyFriendAccepted(event.requesterUserId(), event.accepterUserId());
        } catch (Exception e) {
            log.warn("친구 수락 푸시 실패 — requesterUserId={}", event.requesterUserId(), e);
        }
    }
}

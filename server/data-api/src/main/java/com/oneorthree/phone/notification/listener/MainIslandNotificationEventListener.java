package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.config.NotificationAsyncConfig;
import com.oneorthree.phone.group.event.MainIslandTransferredEvent;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.service.MainIslandNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 메인 섬 자동 이전 → <b>구 경로</b> 푸시 어댑터 (GROMO-1971).
 *
 * <p>{@code AFTER_COMMIT} 인 이유는 {@link FriendNotificationEventListener} 와 같다 — 이전이 롤백되는데
 * 알림만 나가는 일을 막고, FCM 왕복이 도메인 트랜잭션의 커넥션을 붙잡지 않게 한다({@code @Async} 가
 * 그 두 번째 조건을 지킨다: {@code afterCommit} 콜백은 바깥 트랜잭션의 JDBC 리소스가 정리되기 전에
 * 돌아서, 요청 스레드에서 그대로 발송하면 요청 하나가 커넥션 두 개를 문다).
 *
 * <p><b>신 경로에서는 아무 일도 하지 않는다.</b> OUTBOX 모드에서는 {@link NotificationRequestOutboxListener}
 * 가 이미 {@code BEFORE_COMMIT} 에 같은 사건을 적었다 — 여기서 또 처리하면 같은 알림이 FCM 으로도 가고
 * Kafka 로도 간다. 모드 판정의 정본은 {@link NotificationDispatcher} 이고 이 가드는 그것을 읽을 뿐이다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MainIslandNotificationEventListener {

    private final NotificationDispatcher notificationDispatcher;
    private final MainIslandNotificationService mainIslandNotificationService;

    /**
     * 이전이 커밋된 뒤 옮겨진 본인에게 알린다.
     *
     * @param event 방금 커밋된 이전. 발송이 실패해도 예외를 밖으로 흘리지 않는다 — 이미 커밋된
     *              이탈·강퇴를 되돌릴 방법이 없고, 비동기라 되돌려 줄 호출자도 없다
     */
    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onMainIslandTransferred(MainIslandTransferredEvent event) {
        if (notificationDispatcher.isOutboxMode()) {
            return;
        }
        try {
            mainIslandNotificationService.notifyTransferred(event);
        } catch (Exception e) {
            log.warn("메인 섬 이전 푸시 실패 — userId={}", event.userId(), e);
        }
    }
}

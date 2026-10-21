package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.config.NotificationAsyncConfig;
import com.oneorthree.phone.group.event.IslandKickedEvent;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.service.IslandKickNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 섬 강퇴 → <b>구 경로</b> 푸시 어댑터 (GROMO-2315). {@code AFTER_COMMIT} + {@code @Async} 인 이유와 신 경로에서
 * 빠지는 이유는 {@link MainIslandNotificationEventListener} 와 같다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IslandKickNotificationEventListener {

    private final NotificationDispatcher notificationDispatcher;
    private final IslandKickNotificationService islandKickNotificationService;

    /**
     * 강퇴가 커밋된 뒤 강퇴된 본인에게 알린다.
     *
     * @param event 방금 커밋된 강퇴. 발송 실패는 밖으로 흘리지 않는다 — 이미 커밋된 강퇴를 되돌릴 수 없다
     */
    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onIslandKicked(IslandKickedEvent event) {
        if (notificationDispatcher.isOutboxMode()) {
            return;
        }
        try {
            islandKickNotificationService.notifyKicked(event);
        } catch (Exception e) {
            log.warn("강퇴 푸시 실패 — userId={}", event.userId(), e);
        }
    }
}

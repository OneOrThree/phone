package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.group.event.GroupBetWonEvent;
import com.oneorthree.phone.notification.config.NotificationAsyncConfig;
import com.oneorthree.phone.notification.service.BetWonNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;

/**
 * 승리 확정 푸시 {@code BET_WON} 의 진입점(PRD FR-43) — {@link GroupBetWonEvent} 의 두 소비자 중
 * 알림 쪽이다.
 *
 * <p><b>정산 트리거({@code GroupBetEarlySettlementListener})와 반드시 별도 빈이어야 한다</b>
 * (이벤트 javadoc): 그쪽은 <b>전원 확정</b>이 아니면 즉시 반환하므로, 한 리스너로 묶으면 혼자 먼저
 * 달성한 사람에게는 푸시가 영영 가지 않는다 — FR-43 이 약속한 "목표를 채운 순간, 본인에게"가
 * 통째로 사라진다. 두 소비자는 서로의 조기 반환에 영향을 받지 않아야 한다.
 *
 * <p>{@code AFTER_COMMIT} — 조기 확정({@code confirmWin})이 롤백되면 리스너까지 오지 않는다.
 * {@code @Async} — FCM 은 blocking 이라 집중 세션 저장 요청 스레드에 얹지 않는다.
 * 예외는 삼킨다 — 축하 푸시 1건 유실이 집중 기록을 방해하면 안 되고, 그 회차의 결과는 정산 후
 * {@code BET_RESULT} 가 다시 알린다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class BetWonNotificationListener {

    private final BetWonNotificationService betWonNotificationService;

    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onBetWon(GroupBetWonEvent event) {
        try {
            betWonNotificationService.sendWonNotification(event, Instant.now());
        } catch (RuntimeException e) {
            log.warn("승리 확정 푸시 실패 — userId={}, sessionId={}", event.userId(), event.sessionId(), e);
        }
    }
}

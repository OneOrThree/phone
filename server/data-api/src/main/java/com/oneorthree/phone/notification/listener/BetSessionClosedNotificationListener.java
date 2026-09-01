package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.group.event.GroupBetSessionClosedEvent;
import com.oneorthree.phone.config.NotificationAsyncConfig;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Instant;

/**
 * 회차 종료(정산·무효화 환불) 알림의 <b>진입점</b>(GROMO-1417) — 발송 로직은
 * {@link BetEventNotificationService} 가 갖는다({@code ChallengeCreatedNotificationListener} 와
 * 같은 구조: 언제·어느 스레드·실패 격리만 여기서 정한다).
 *
 * <p>{@code AFTER_COMMIT} — 정산·환불이 커밋된 뒤에만 온다. BET_VOID_REFUND(N48)의 "무효화+환불
 * 커밋 직후 발송, 커밋 전 발송 금지"가 이 배선으로 보장된다(롤백되면 리스너까지 오지 않는다).
 * {@code @Async} — FCM 은 blocking 호출이라 정산 스레드(크론·조기 정산 리스너·삭제 요청)에
 * 얹지 않는다. 커밋 완료 스레드에서 트랜잭션을 다시 열지 않기 위한 격리이기도 하다
 * (AFTER_COMMIT 시점의 원 스레드에서 REQUIRED 로 합류하면 이미 끝난 트랜잭션에 붙는다).
 *
 * <p>예외는 삼킨다 — 여기서 유실돼도 15분 재훑기 크론이 같은 dedup 축으로 회수한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class BetSessionClosedNotificationListener {

    private final BetEventNotificationService betEventNotificationService;

    @Async(NotificationAsyncConfig.PUSH_EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSessionClosed(GroupBetSessionClosedEvent event) {
        try {
            betEventNotificationService.notifySessionClosed(event.sessionId(), Instant.now());
        } catch (RuntimeException e) {
            log.warn("회차 종료 알림 처리 실패 — 재훑기 크론이 회수한다. sessionId={}",
                    event.sessionId(), e);
        }
    }
}

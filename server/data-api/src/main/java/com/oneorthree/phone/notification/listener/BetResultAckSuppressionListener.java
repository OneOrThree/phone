package com.oneorthree.phone.notification.listener;

import com.oneorthree.phone.group.event.BetResultAcknowledgedEvent;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 확인한 결과의 푸시를 억제한다 (B17 · GROMO-1656) — {@link BetResultAcknowledgedEvent} 의 유일한 소비자.
 *
 * <p><b>이 리스너만 동기다.</b> 같은 패키지의 다른 알림 리스너들은
 * {@code @TransactionalEventListener(AFTER_COMMIT) + @Async} 인데 여기는 평범한
 * {@code @EventListener} 다 — 발행 트랜잭션 <b>안에서 지금</b> 돌아야 하기 때문이다.
 *
 * <p><b>먼저, 동기가 아닌 이유부터 지운다.</b> 「클레임을 만드는 리스너가 늦게 와서 순서가 뒤집힌다」는
 * 것은 <b>동기여야 할 이유가 아니다</b> — {@code suppressResultPushOnAck} 이 tombstone 을 먼저 박고
 * {@code insertPendingClaim} 이 {@code ON CONFLICT (user_id, kind, subject_id) DO NOTHING} 이라,
 * 늦게 온 클레임은 어느 쪽이 먼저 커밋하든 제약이 흡수한다. 그건 순서가 아니라 <b>제약</b>이 지킨다.
 *
 * <p><b>진짜 이유는 둘이다.</b>
 * <ul>
 *   <li><b>5분 flush 크론과의 창</b> — {@code NotificationScheduler.flushBetEventNotifications}
 *       ({@code cron = "0 *&#47;5 * * * *"})가 슬롯이 닫힌 {@code PENDING} 을 집어 발송한다. 억제가
 *       비동기 큐에서 지연되는 동안 그 크론이 끼면 <b>이미 본 결과의 푸시가 나간다</b>. ack 트랜잭션
 *       안에서 즉시 닫으면 그 창이 사실상 사라진다</li>
 *   <li><b>롤백 결합</b> — 억제가 실패하면 ack 도 함께 되돌아가야 한다. 「확인은 됐는데 푸시 억제는
 *       안 된」 반쪽 상태가 바로 이 기능이 없애려던 것이고, 이건 같은 트랜잭션일 때만 성립한다</li>
 * </ul>
 *
 * <p>그래서 여기서는 <b>예외를 삼키지 않는다</b>. 종전에 {@code ChallengeResultAckService} 가
 * 알림 서비스를 직접 부르던 것과 성질이 같다 — 이벤트로 바꾼 것은 의존 방향을 뒤집기 위해서지
 * (group 이 notification 을 참조하지 않도록) 실행 시점을 미루기 위해서가 아니다.
 */
@Component
@RequiredArgsConstructor
public class BetResultAckSuppressionListener {

    private final BetEventNotificationService betEventNotificationService;

    /**
     * 이미 있는 미발송 클레임을 닫고, 아직 없으면 tombstone 을 남겨 나중에 오는 클레임까지 막는다.
     *
     * @param event 확인이 실제로 성사된 회차·유저. 멱등 no-op 이나 거절 경로에서는 발행되지 않는다
     */
    @EventListener
    public void onResultAcknowledged(BetResultAcknowledgedEvent event) {
        betEventNotificationService.suppressResultPushOnAck(event.userId(), event.sessionId(), event.now());
    }
}

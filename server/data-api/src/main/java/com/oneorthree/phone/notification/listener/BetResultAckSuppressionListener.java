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
 * {@code @EventListener} 다 — 발행 트랜잭션 <b>안에서 지금</b> 돌아야 하기 때문이다. 이유가 둘이다.
 *
 * <ul>
 *   <li>클레임을 만드는 리스너가 {@code AFTER_COMMIT + @Async} 라 ack 보다 늦게 올 수 있다.
 *       억제까지 커밋 이후로 미루면 그 사이에 <b>이미 본 결과의 푸시가 나간다</b></li>
 *   <li>억제가 실패하면 ack 도 함께 롤백되는 것이 맞다. 「확인은 됐는데 푸시 억제는 안 된」
 *       반쪽 상태가 바로 이 기능이 없애려던 것이다</li>
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

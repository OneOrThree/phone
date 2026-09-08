package com.oneorthree.phone.group.event;

import java.time.Instant;
import java.util.UUID;

/**
 * 유저가 회차 결과 모달을 <b>확인했다</b>는 도메인 이벤트 (B17 · GROMO-1656).
 *
 * <p>{@code ChallengeResultAckService.acknowledge} 가 확인 처리가 실제로 성사됐을 때만 발행한다
 * (멱등 no-op·거절 경로에서는 발행하지 않는다). 소비자는 알림 파이프라인 하나이며, 아직 안 나간
 * 결과 푸시 클레임을 닫고 tombstone 을 남긴다.
 *
 * <p><b>이 이벤트는 커밋 이후가 아니라 «지금» 소비돼야 한다</b> — 다른 이벤트들과 다른 점이라
 * 여기 적어 둔다. 소비자는 {@code @EventListener}(동기, 발행 트랜잭션 안)여야 하고
 * {@code @TransactionalEventListener} 를 쓰면 안 된다. 이유는 소비자 쪽에 적어 두었다.
 *
 * @param userId    확인한 유저 — 확인 표시는 유저별이라 다른 멤버의 모달 큐에는 영향이 없다
 * @param sessionId 확인된 회차
 * @param now       클레임 종결·tombstone 이 쓸 시각. 확인 시각({@code acknowledged_at})은 DB 시계로
 *                  따로 찍히므로 이 값이 아니다 — 알림 파이프라인이 인스턴스 시각을 쓰는 축이다
 */
public record BetResultAcknowledgedEvent(UUID userId, UUID sessionId, Instant now) {
}

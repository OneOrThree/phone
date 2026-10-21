package com.oneorthree.phone.group.event;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬에서 <b>강퇴됐다</b>는 도메인 이벤트 (GROMO-2315) — 강퇴된 본인에게 앱 알림 1건을 보내는 근거다.
 *
 * <p>강퇴 경로가 모두 지나는 {@code GroupMemberService.kickMemberAndRecord} 가 발행한다. 그 섬이 메인 섬이었어도
 * {@link MainIslandTransferredEvent} 는 내지 않는다(10/20 결정 — 강퇴 알림 1건만). 소비자와 단계는 메인 섬 이전과
 * 같다 — 신 경로 {@code NotificationRequestOutboxListener}({@code BEFORE_COMMIT}), 구 경로
 * {@code IslandKickNotificationEventListener}({@code AFTER_COMMIT}).
 *
 * @param userId     강퇴된 사람 — 알림 수신자
 * @param islandId   강퇴된 섬
 * @param islandName 강퇴된 섬 이름 — 렌더 입력
 * @param occurredAt 강퇴 시각 — 결정적 사건 키의 시간 축이다(발송 시각이 아니다)
 */
public record IslandKickedEvent(UUID userId, UUID islandId, String islandName, Instant occurredAt) {
}

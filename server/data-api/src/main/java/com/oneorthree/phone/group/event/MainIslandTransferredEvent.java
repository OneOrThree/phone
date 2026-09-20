package com.oneorthree.phone.group.event;

import java.time.Instant;
import java.util.UUID;

/**
 * 메인 섬을 잃어 <b>자동으로 옮겨졌다</b>는 도메인 이벤트 (GROMO-1971).
 *
 * <p>이탈·강퇴·계정탈퇴가 메인 섬의 멤버십을 끝내면 {@code MainIslandService} 가 남은 섬 중 가장 최근에
 * 가입한 섬으로 옮기고 이 사건을 발행한다. 사용자가 {@code PATCH /me} 로 <b>직접 고른</b> 변경은 발행하지
 * 않는다 — 자기가 한 일을 알림으로 되돌려 주지 않는다.
 *
 * <p>소비자는 {@code notification/listener/NotificationRequestOutboxListener} 이고 단계는
 * {@code BEFORE_COMMIT} 이다. 이전과 알림이 <b>같은 트랜잭션</b>에 들어가야 「섬은 옮겨졌는데 알림은
 * 사라진」 반쪽이 없다(그 리스너의 클래스 주석). 옮길 섬이 없으면(소속 0) 발행하지 않는다 — 알릴 새 섬이
 * 없는 데다 그 복구는 GROMO-1995 소관이다.
 *
 * <p>엔티티가 아니라 식별자와 <b>이름 문자열</b>을 싣는다. 리스너가 렌더 입력으로 이름을 쓰는데 지연 로딩
 * 프록시를 실으면 소비 시점의 영속성 컨텍스트에 기대게 된다.
 *
 * @param userId     메인 섬을 옮긴 사람 — 알림 수신자
 * @param islandId   새 메인 섬
 * @param islandName 새 메인 섬 이름 — 렌더 입력
 * @param occurredAt 이전이 일어난 시각 — 결정적 사건 키의 시간 축이다(발송 시각이 아니다)
 */
public record MainIslandTransferredEvent(UUID userId, UUID islandId, String islandName, Instant occurredAt) {
}

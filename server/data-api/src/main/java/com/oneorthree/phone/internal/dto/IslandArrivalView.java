package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code POST /internal/users/{userId}/islands/{islandId}/arrivals} 응답 (GROMO-2260, 섬 외부 계약 §1).
 *
 * @param arrivedBefore    항상 true — 이 호출이 기록을 남겼다
 * @param membershipStatus {@code active|pending|none} — 본인 기준
 * @param currentIslandId  도착 처리 뒤 현재 섬. 주민이면 도착한 섬, 방문자면 그대로(없으면 null)
 */
public record IslandArrivalView(UUID islandId, boolean arrivedBefore, String membershipStatus,
        UUID currentIslandId) {
}

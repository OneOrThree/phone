package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 나가기·강퇴 뒤 그 사람이 서 있게 될 곳 (GROMO-2260, 섬 외부 계약 §1).
 *
 * <p>{@code islandId} 가 null 이면 먼바다다(남은 소속 중 가 본 섬이 없다). 값은 응답 시점의 현재 섬
 * 컨텍스트와 같다 — {@code UserIslandContextRecovery} 가 같은 규칙(남은 소속 중 최근 머문 섬)으로 옮긴다.
 */
public record NextLocationView(UUID islandId) {
}

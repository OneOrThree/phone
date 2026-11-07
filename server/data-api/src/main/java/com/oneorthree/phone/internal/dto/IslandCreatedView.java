package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code POST /internal/users/{userId}/islands} 응답 (GROMO-1759, LLD §3.1).
 *
 * <p>생성자는 그 자리에서 방장이 되고 현재 섬이 새 섬으로 옮겨진다. 그래서 {@code membershipStatus}
 * 는 {@code active}, {@code role} 은 {@code host} 이며 {@code currentIslandId} 는 새 섬 id 다.
 * 웹 전용 섬 배정은 같은 응답 형식에 {@code member} 역할과 배정된 섬 id를 반환한다.
 */
public record IslandCreatedView(UUID id, String membershipStatus, String role, UUID currentIslandId) {
}

package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code POST /internal/users/{userId}/islands} 응답 (GROMO-1759, LLD §3.1).
 *
 * <p>생성자는 그 자리에서 방장이 되고 현재 섬이 새 섬으로 옮겨진다. 그래서 {@code membershipStatus}
 * 는 항상 {@code active}, {@code role} 은 항상 {@code host} 이며 {@code currentIslandId} 는 새 섬 id 다.
 */
public record IslandCreatedView(UUID id, String membershipStatus, String role, UUID currentIslandId) {
}

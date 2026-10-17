package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * 친구(수락·미삭제) 상대 id 목록 (GROMO-2299, 계약 §2) — realtime 이 바다 방 배정 우선순위에만 쓴다.
 *
 * @param ids 친구 상대 사용자 id. 순서 없음
 */
public record FriendIdsView(List<UUID> ids) {
}

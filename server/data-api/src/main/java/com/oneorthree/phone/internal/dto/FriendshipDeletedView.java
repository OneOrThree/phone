package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 친구 삭제의 내부 응답 (GROMO-1894, friend-letter LLD §1.4). 공개 계약은 본문이 없지만 내부 표면은
 * 빈 본문을 쓰지 않는다 — 실제로 소프트 삭제된 관계 행 id 를 돌려준다({@link FriendRequestStateView} 와 같은 이유).
 *
 * @param friendshipId 소프트 삭제된 {@code friendships} 행 id
 */
public record FriendshipDeletedView(UUID friendshipId) {
}

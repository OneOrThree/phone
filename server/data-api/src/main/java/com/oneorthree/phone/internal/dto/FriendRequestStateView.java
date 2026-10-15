package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;

import java.util.UUID;

/**
 * 친구 요청 명령(생성·수락·거절·취소)의 내부 응답 (GROMO-1894).
 *
 * <p>공개 계약(friend-letter LLD §1.1~1.3·1.11)은 본문이 없지만, 내부 표면은 «없음»을 빈 본문으로
 * 표현하지 않는다 — Business 의 {@code InternalHttpClient} 가 빈 2xx 를 「상류가 그 일을 했다」로 읽지
 * 않도록 결과 상태를 한 겹으로 돌려준다. 공개 응답은 Business 가 {@code {"data": null}} 로 접는다.
 *
 * @param requestId 이 명령이 다룬 요청 행 id — 생성은 복원·재전환된 행이면 그 행의 id 다
 * @param status    명령 뒤의 행 상태
 */
public record FriendRequestStateView(UUID requestId, FriendshipStatus status) {
}

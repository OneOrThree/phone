package com.oneorthree.phone.friend.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

/**
 * 친구 요청 목록의 한 건. 받은 요청이든 보낸 요청이든 담기는 유저는 항상 <b>상대</b>다 — 내 정보는 넣지 않는다.
 */
@Getter
@Builder
public class FriendRequestResponse {
    private UUID requestId;
    private UUID userId;
    private String nickname;
    private Integer tierLevel;
    /**
     * 이 요청 사이클이 시작된 시각 — 행의 createdAt 이 아니라 updatedAt 이 소스다(재전환·복원 시
     * createdAt 은 원래 관계의 시각이 남는다). 와이어 필드명은 기존 계약대로 유지 (GROMO-719).
     */
    private Instant createdAt;
}

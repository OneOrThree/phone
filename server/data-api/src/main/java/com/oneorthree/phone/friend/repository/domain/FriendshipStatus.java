package com.oneorthree.phone.friend.repository.domain;

/**
 * 친구 관계 행의 상태. 거절해도 행을 지우지 않으므로 같은 두 유저의 이력이 한 행을 오가며 재사용된다.
 */
public enum FriendshipStatus {
    /** 보낸 쪽만 확정된 상태 — 수신자의 수락·거절을 기다린다. */
    PENDING,
    /** 양쪽 친구로 성립. 친구 목록·핀·라이브 정보 노출의 기준이다. */
    ACCEPTED,
    /** 수신자가 거절함. 행이 남아 있어 같은 상대의 재요청이 이 행을 PENDING 으로 되살린다. */
    REJECTED
}

package com.oneorthree.phone.friend.dto;

/**
 * 검색 결과에서 나와 해당 유저의 기존 관계 표기 (GROMO-460 §6 검색 응답)
 */
public enum FriendRelation {
    /** 아무 관계 없음 — 검색 결과에서 친구 요청 버튼을 띄우는 유일한 값. */
    NONE,
    /** PENDING 요청 존재 (내가 보냈거나 받음) — 방향은 구분하지 않아 양쪽 모두 "요청중"으로 보인다. */
    PENDING,
    /** 이미 ACCEPTED 친구 — 요청 버튼 대신 친구 배지를 그린다. */
    FRIEND
}

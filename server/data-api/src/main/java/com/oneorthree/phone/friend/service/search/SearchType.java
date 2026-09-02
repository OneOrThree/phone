package com.oneorthree.phone.friend.service.search;

/**
 * 친구 검색 수단. 값 하나가 {@link FriendSearchStrategy} 구현체 하나와 짝을 이루며, 구현체가 없는 값으로
 * 요청하면 400 이 된다.
 */
public enum SearchType {
    /** 닉네임 유사도(pg_trgm) 검색. */
    NICKNAME,
    /** 초대 코드 검색 — 값만 열어 뒀고 아직 전략 구현체가 없다. */
    CODE
}

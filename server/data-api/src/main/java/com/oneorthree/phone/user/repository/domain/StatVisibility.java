package com.oneorthree.phone.user.repository.domain;

/**
 * 개인 통계 공개 범위. schema.dbml 의 enum stat_visibility 와 동일.
 * 기본값은 보수적(좁은 공개)인 FRIENDS.
 */
public enum StatVisibility {
    /** 친구에게만 — 기본값. 좁은 쪽을 기본으로 둬 실수로 공개되는 일이 없게 한다. */
    FRIENDS,
    /** 전체 공개 — 친구가 아니어도 세부 통계를 볼 수 있다. */
    PUBLIC
}

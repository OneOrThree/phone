package com.oneorthree.phone.user.domain;

/**
 * 개인 통계 공개 범위. schema.dbml 의 enum stat_visibility 와 동일.
 * 기본값은 보수적(좁은 공개)인 FRIENDS.
 */
public enum StatVisibility {
    FRIENDS,
    PUBLIC
}

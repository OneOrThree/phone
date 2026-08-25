package com.oneorthree.phone.group.domain;

/**
 * GROMO-676: 멤버 단위 공지 작성 권한 (dbml enum group_announcement_grant) — 방장은 컬럼과 무관하게 항상 가능
 */
public enum GroupAnnouncementGrant {
    DISALLOW, ALLOW
}

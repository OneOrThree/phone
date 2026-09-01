package com.oneorthree.phone.group.repository.domain;

/**
 * GROMO-676: 멤버 단위 공지 작성 권한 (dbml enum group_announcement_grant) — 방장은 컬럼과 무관하게 항상 가능
 */
public enum GroupAnnouncementGrant {
    /** 공지 작성 불가 — 참여·재참여 시의 기본값. 방장에게는 이 값이어도 영향이 없다. */
    DISALLOW,
    /** 방장이 개별 부여한 공지 작성 권한. 강등·재참여로는 남지 않고 DISALLOW 로 초기화된다. */
    ALLOW
}

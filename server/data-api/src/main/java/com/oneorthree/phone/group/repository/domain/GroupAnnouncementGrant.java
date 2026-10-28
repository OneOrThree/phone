package com.oneorthree.phone.group.repository.domain;

/** 과거 주민별 공지 권한 저장값. 현재 공지 작성 인가에서는 사용하지 않는다. */
public enum GroupAnnouncementGrant {
    /** 공지 작성 불가 — 참여·재참여 시의 기본값. 방장에게는 이 값이어도 영향이 없다. */
    DISALLOW,
    /** 방장이 개별 부여한 공지 작성 권한. 강등·재참여로는 남지 않고 DISALLOW 로 초기화된다. */
    ALLOW
}

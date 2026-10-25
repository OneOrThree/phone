package com.oneorthree.phone.group.repository.domain;

/** 과거 섬별 초대·구매 권한 저장값. 현재 권한 정책은 이 필드를 읽지 않는다. */
public enum GroupPermissionScope {
    /** 방장만 — 그룹 생성 시 기본값. */
    OWNER_ONLY,
    /** 일반 멤버까지 전원 허용. */
    ALL_MEMBERS;
}

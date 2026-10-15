package com.oneorthree.phone.group.repository.domain;

/**
 * 그룹 설정에서 "누가 할 수 있는가"를 정하는 권한 범위 — 현재 쓰는 곳은 {@code Group.invitePermission}
 * (초대 권한) 하나다. 공지 작성 권한은 멤버 단위라 이 범위가 아니라 {@link GroupAnnouncementGrant} 를 쓴다.
 */
public enum GroupPermissionScope {
    /** 방장만 — 그룹 생성 시 기본값. */
    OWNER_ONLY,
    /** 일반 멤버까지 전원 허용. */
    ALL_MEMBERS;
}

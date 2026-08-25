package com.oneorthree.phone.group.domain;

/**
 * 미사용 — 유저 직접 초대 기능을 접었고, 참여는 초대 링크(groupId)가 담당한다(2026-07-31).
 * 서비스·컨트롤러 참조 0건. 삭제하지 않는 이유는 참가 코드 체계와 같다(잔존 비용 &lt; 삭제 비용).
 */
public enum GroupInviteStatus {
    PENDING, ACCEPTED, DECLINED
}

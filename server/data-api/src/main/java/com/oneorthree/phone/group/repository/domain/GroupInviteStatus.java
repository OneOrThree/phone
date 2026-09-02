package com.oneorthree.phone.group.repository.domain;

/**
 * 미사용 — 유저 직접 초대 기능을 접었고, 참여는 초대 링크(groupId)가 담당한다(2026-07-31).
 * 서비스·컨트롤러 참조 0건. 삭제하지 않는 이유는 참가 코드 체계와 같다(잔존 비용 &lt; 삭제 비용).
 */
public enum GroupInviteStatus {
    /** 초대 발송 후 응답 대기(발급 시 기본값). */
    PENDING,
    /** 피초대자가 수락 — 멤버 행이 생기는 시점이었다. */
    ACCEPTED,
    /** 피초대자가 거절 — 같은 그룹에 재초대는 막지 않았다. */
    DECLINED
}

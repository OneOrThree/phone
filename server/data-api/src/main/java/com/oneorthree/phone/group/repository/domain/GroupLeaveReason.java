package com.oneorthree.phone.group.repository.domain;

/**
 * 그룹 이탈 사유 (A-0 소프트삭제). 활성 멤버는 null.
 * LEFT = 자진 탈퇴(재참여 허용), KICKED = 강퇴(재참여는 섬장 승인 — GROMO-2315 이전에는 차단).
 */
public enum GroupLeaveReason {
    /** 자진 탈퇴 — 같은 행을 되살려 재참여할 수 있다({@code GroupMember.rejoin}). */
    LEFT,
    /**
     * 강퇴 — 행이 남아 재가입을 승인 대기로 돌리는 근거가 된다({@code GroupMember.isKicked}, GROMO-2315). 승인되면
     * {@code GroupMember.rejoin} 이 사유를 지운다.
     */
    KICKED
}

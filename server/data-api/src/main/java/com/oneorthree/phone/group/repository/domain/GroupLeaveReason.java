package com.oneorthree.phone.group.repository.domain;

/**
 * 그룹 이탈 사유 (A-0 소프트삭제). 활성 멤버는 null.
 * LEFT = 자진 탈퇴(재참여 허용), KICKED = 강퇴(재참여 차단).
 */
public enum GroupLeaveReason {
    /** 자진 탈퇴 — 같은 행을 되살려 재참여할 수 있다({@code GroupMember.rejoin}). */
    LEFT,
    /** 강퇴 — 행이 남아 재참여를 막는 근거가 된다({@code GroupMember.isKicked}). 해제 경로는 없다. */
    KICKED
}

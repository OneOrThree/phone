package com.oneorthree.phone.group.domain;

// 그룹 이탈 사유 (A-0 소프트삭제). 활성 멤버는 null.
// LEFT = 자진 탈퇴(재참여 허용), KICKED = 강퇴(재참여 차단).
public enum GroupLeaveReason {
    LEFT,
    KICKED
}

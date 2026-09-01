package com.oneorthree.phone.group.repository.domain;

/**
 * 그룹 멤버의 활동 상태 (챌린지/포커스 진행 여부)
 *
 * <p>현재 프로덕션이 쓰는 값은 기본값 {@link #INACTIVE} 뿐이다 — 실시간 진행 여부는 이 컬럼이 아니라
 * 포커스 세션·회차 참가 행을 직접 조회해 계산한다. 나머지 둘은 스키마에만 남아 있다.
 */
public enum GroupMemberStatus {
    /** 진행 중인 것이 없음 — 참여·재참여 시의 기본값. */
    INACTIVE,
    /** 챌린지 진행 중(미배선 — 현재 이 값을 쓰는 경로는 없다). */
    CHALLENGE,
    /** 포커스 세션 진행 중(미배선 — 현재 이 값을 쓰는 경로는 없다). */
    FOCUS
}

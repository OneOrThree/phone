package com.oneorthree.phone.group.repository.domain;

/**
 * 챌린지 수명주기 — policy §A8 상태도(ACTIVE → ENDED). 삭제는 상태가 아니라 deleted_at(소프트 딜리트) 축이다.
 *
 * <p>종전 INACTIVE(V2 가 레거시 ENDED 행을 보존하던 이름)는 V34 가 ENDED 로 되돌렸다 —
 * "끝난 챌린지"의 이름은 정책 정본(§A8)의 ENDED 하나만 쓴다.
 */
public enum GroupChallengeStatus {
    /** 진행 중 — 회차 개설·참가·알림 스캔이 모두 이 상태만 훑는다. 생성 시의 유일한 초기값이다. */
    ACTIVE,
    /** 종료 — 새 회차가 열리지 않는다. 이미 열린 회차의 정산은 상태와 무관하게 제 갈 길을 간다. */
    ENDED
}

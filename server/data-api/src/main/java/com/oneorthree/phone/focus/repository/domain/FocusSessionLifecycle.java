package com.oneorthree.phone.focus.repository.domain;

/**
 * v0.3 집중 세션 상세({@link FocusSessionDetail})의 생명주기 (GROMO-1764).
 *
 * <p>레거시 {@link FocusSessionStatus}와는 별개 축이다 — HLD가 "enum 일괄 개명 금지, 새 lifecycle은
 * 별도 상세 행에서 해석"이라고 정했으므로 기존 enum에 값을 더하지 않고 이 표의 컬럼으로 둔다.
 * 기본 {@code FocusSession} 행은 진행 중(active/paused) 동안 {@code status=ACTIVE, endedAt=null}을
 * 유지하고, 이 값이 실제 "지금 집중 중인가/쉬는 중인가"를 가른다.
 */
public enum FocusSessionLifecycle {
    /** 집중 중 — 열린 ACTIVE 구간이 있다. */
    ACTIVE,
    /** 일시정지(모닥불 휴식) — 열린 REST 구간이 있다. */
    PAUSED,
    /** 정상 완료 — finish 정산까지 끝났다. 지급 게이트가 닫혀 있는 동안은 도달하지 않는다. */
    COMPLETED
}

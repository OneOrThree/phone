package com.oneorthree.phone.focus.domain;

/**
 * 집중 세션 상태값. varchar + CHECK 제약(V2)으로 저장되며 {@code @Enumerated(STRING)} 매핑.
 */
public enum FocusSessionStatus {
    /** 진행 중. 완료(종료 시각 기록)된 세션도 상태는 계속 ACTIVE 로 남는다(아래 COMPLETED 참고). */
    ACTIVE,
    /**
     * <b>현재 미사용(dead value).</b> 세션 완료 로직(FocusService.recordCompletion/endFocusSession)은
     * endedAt 만 채우고 상태는 ACTIVE 로 유지하므로 이 값을 쓰는 경로가 없다. 값 변경(정상 완료를 COMPLETED 로
     * 전환)은 동작 변경이라 GROMO-779 스코프 밖 — 별도 후속에서 다룬다.
     */
    COMPLETED,
    CANCELED
}

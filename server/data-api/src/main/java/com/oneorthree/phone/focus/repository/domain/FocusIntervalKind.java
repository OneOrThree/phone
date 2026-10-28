package com.oneorthree.phone.focus.repository.domain;

/** {@link FocusSessionInterval} 구간의 종류 — 순수 집중(ACTIVE)인지 일시정지(REST)인지 (GROMO-1764). */
public enum FocusIntervalKind {
    /** 서버가 순수 집중으로 계수하는 구간. */
    ACTIVE,
    /** 일시정지(모닥불 휴식) 구간 — activeSeconds에 더하지 않는다. */
    REST
}

package com.oneorthree.phone.group.domain;

/**
 * 그룹 챌린지 내기 상태.
 *
 * <p>{@code OPEN} 만 참가 가능하며, 일 배치가 정산 대상으로 훑는 유일한 상태다.
 * 정산 재실행 시 이미 {@code SETTLED}/{@code REFUNDED} 인 내기는 이 값으로 스킵된다(멱등 1차 가드).
 */
public enum GroupBetStatus {
    /** 참가 가능(당일). 정산 전. */
    OPEN,
    /** 정산 완료 — 달성자에게 팟 분배. */
    SETTLED,
    /** 달성자 0명 → 전원 환불로 종료. */
    REFUNDED
}

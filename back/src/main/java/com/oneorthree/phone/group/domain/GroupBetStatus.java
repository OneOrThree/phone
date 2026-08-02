package com.oneorthree.phone.group.domain;

/**
 * 그룹 챌린지 내기 상태.
 *
 * <p>{@code OPEN} 만 참가 가능하며, 일 배치가 정산 대상으로 훑는 유일한 상태다.
 * 정산 재실행 시 이미 종료된({@code OPEN} 이 아닌) 내기는 이 값으로 스킵된다(멱등 1차 가드).
 *
 * <p>종료 상태 전이는 전부 {@code GroupChallengeBetRepository.compareAndSetSettled} 의
 * 원자적 CAS 를 거친다 — 정산 배치·취소·탈퇴 연동이 동시에 겹쳐도 한 경로만 돈을 움직인다.
 */
public enum GroupBetStatus {
    /** 참가 가능(당일). 정산 전. */
    OPEN,
    /** 정산 완료 — 달성자에게 팟 분배. */
    SETTLED,
    /**
     * 달성자 0명 → 전원 환불로 종료.
     *
     * @deprecated 몰수 룰 도입으로 정산이 더는 이 상태를 만들지 않는다(승자 0명은 {@link #FORFEITED}).
     *             기존 데이터가 남아 있어 값 자체는 유지한다 — 조회·표시 경로에서는 계속 다뤄야 한다.
     */
    @Deprecated
    REFUNDED,
    /** 승자 0명 → 팟 전액 몰수·소멸. 아무에게도 지급하지 않는다. */
    FORFEITED,
    /**
     * 정산 전 취소 — 개설자 단독(참가자가 개설자뿐)일 때의 명시적 취소, 또는 그룹 탈퇴 연동의
     * 자동 취소. 판돈은 환불된다. 지난 내기 조회(lastSettledBet)에는 노출하지 않는다.
     */
    CANCELED
}

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
     * <b>회차 무효화 + 전원 전액 환불</b> — 정산 자체가 불가능한 회차를 닫는 최후 처분(정책 §E1).
     *
     * <p>정산이 24시간 넘게 성공하지 못한 OPEN 내기를 {@code GroupBetFreezeMonitor} 가 감지해
     * {@code GroupBetService.refundFrozenBet} 으로 이 상태로 닫고 참가비를 돌려준다. "정산은
     * 되돌리지 않는다"와 충돌하지 않는다 — 정산된 건을 되돌리는 게 아니라 정산이 영원히 불가능한
     * 건(참가자 유실·챌린지 목표 유실·분배 불변식 위반)을 닫는 것이다.
     *
     * <p>이력 메모: 원래 의미는 "달성자 0명 → 전원 환불"이었고 몰수 룰 도입({@link #FORFEITED})으로
     * 생성 코드가 사라져 한동안 deprecated 였다. GROMO-1258 에서 위 의미로 되살렸다 — 그 사이에
     * 쌓인 옛 데이터도 "전원 환불로 끝난 회차"라 조회·표시 취급은 같다.
     */
    REFUNDED,
    /** 승자 0명 → 팟 전액 몰수·소멸. 아무에게도 지급하지 않는다. */
    FORFEITED,
    /**
     * 정산 전 취소 — 개설자 단독(참가자가 개설자뿐)일 때의 명시적 취소, 또는 그룹 탈퇴 연동의
     * 자동 취소. 판돈은 환불된다. 지난 내기 조회(lastSettledBet)에는 노출하지 않는다.
     */
    CANCELED
}

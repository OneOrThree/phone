package com.oneorthree.phone.group.repository.domain;

/**
 * 회차 무산·환불 사유 (GROMO-1404, N33·N52) — 종료 상태를 보조하는 이유 축.
 *
 * <p>{@code VOIDED} 에는 인원 미달·챌린지 삭제가, 24h 데드라인 자동 환불({@code REFUNDED})에는
 * {@link #REFUND_DEADLINE} 이 붙는다. 사유 없이 상태 하나면 "인원 부족" 카피가 삭제 건까지
 * 거짓말하게 된다(LLD §2.1). 그 외 종료(정상 정산·몰수)는 null 이다.
 */
public enum GroupBetVoidReason {
    /** 참가 마감 시점 인원 미달(2명 미만·환불 대상 1명) — 참가 마감 크론(B4·N47)이 기록한다. */
    INSUFFICIENT_PARTICIPANTS,
    /** 그룹장이 챌린지를 삭제해 OPEN 회차가 무효화·환불됨. */
    CHALLENGE_DELETED,
    /** 정산 24h 데드라인 초과 자동 전원 환불(N21) — B4 배선. */
    REFUND_DEADLINE
}

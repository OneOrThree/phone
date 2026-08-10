package com.oneorthree.phone.group.domain;

/**
 * 회차 정산 진입 트리거(GROMO-1411) — {@code GroupBetSettler.settle} 단일 진입점의 분기 축.
 *
 * <p>트리거가 갈라도 <b>24h 환불 판정(N21)은 공통으로 가장 먼저</b> 본다 — 검사가 스캔 크론에만
 * 있으면 수동·조기 경로가 데드라인을 우회해 환불돼야 할 회차에 지급이 나간다(FR-45 위반).
 */
public enum SettleTrigger {
    /**
     * 5분 주기 정산 스캔(N12) — {@code settle_after} 도달 회차. 그레이스 가드와 창형 FOCUS
     * ACTIVE 세션 대기(N37)를 전부 적용한다.
     */
    CRON,
    /**
     * 조기 정산(N11) — 참가 마감 이후 전원 승리 확정 시. 그레이스 가드를 <b>우회</b>하고
     * (창형 settle_after 는 창 끝+30분이라 가드를 타면 즉시 정산이 영영 발동하지 않는다),
     * 잔여 순위는 시점 진행분으로 확정한다(N32). 전제(마감·전원 확정)는 락 안에서 재검증한다.
     */
    EARLY,
    /**
     * 운영자 수동 트리거 — 배치 API. 가드는 CRON 과 동일하다(그레이스·FOCUS 대기 적용).
     */
    MANUAL
}

package com.oneorthree.phone.league.repository.domain;

/**
 * 아레나의 진행 상태. 주간 배치가 ACTIVE 아레나를 찾아 마감하고 다음 주차 것을 새로 만든다.
 */
public enum LeagueArenaStatus {
    /** 진행 중 — 이번 주차 집계·순위의 대상. */
    ACTIVE,
    /** 마감됨 — 결과가 확정돼 더는 변하지 않는다. 재마감은 조용히 무시된다. */
    ENDED
}

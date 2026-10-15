package com.oneorthree.phone.league.repository.domain;

/** 사용자별 주간 리그 정산 결과. */
public enum LeagueWeeklyResultType {
    /** 승급 — 상위 티어로 올라갔다. 승급 보너스 재화가 함께 지급된다. */
    PROMOTED,
    /** 잔류 — 티어가 그대로다. */
    STAY,
    /** 강등 — 하위 티어로 내려갔다. */
    RELEGATED
}

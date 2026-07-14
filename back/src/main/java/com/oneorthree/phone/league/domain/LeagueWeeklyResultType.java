package com.oneorthree.phone.league.domain;

/** 주간 리그 정산 결과. 전환 중인 구 아레나의 RELEGATE_WARNING 상태는 포함하지 않는다. */
public enum LeagueWeeklyResultType {
    PROMOTED, STAY, RELEGATED
}

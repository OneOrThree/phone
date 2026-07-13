package com.oneorthree.phone.stats.dto;

/**
 * 평균 집중시간 집계 모수(scope) — 어떤 유저 집합의 평균을 낼지 결정한다 (GROMO-753).
 *
 * <ul>
 *   <li>{@link #FRIENDS}  : 호출자의 ACCEPTED 친구 전체(자기 자신 제외).</li>
 *   <li>{@link #TOTAL}    : 전체 유저(탈퇴 유저 제외, 자기 자신 포함).</li>
 *   <li>{@link #CATEGORY} : 호출자와 같은 occupation 유저(자기 자신 포함). occupation 미설정 시 null 응답.</li>
 * </ul>
 */
public enum FocusAverageScope {
    /** 호출자 ACCEPTED 친구 집합. 자기 자신은 친구 집합에 미포함이라 자연 제외. */
    FRIENDS,
    /** 전체 유저(탈퇴 제외). 자기 자신 포함. */
    TOTAL,
    /** 호출자와 동일 occupation 유저. 자기 자신 포함. */
    CATEGORY
}

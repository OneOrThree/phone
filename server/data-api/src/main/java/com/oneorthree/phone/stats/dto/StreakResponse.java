package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

/**
 * 연속 집중일 요약.
 *
 * @param currentStreak    지금 이어지고 있는 연속일. 저장값이 아니라 조회 시점에 만료를 판정한 값이라,
 *                         마지막 집중일이 어제보다 앞서면 0 이다
 * @param longestStreak    역대 최장 연속일 — 만료 판정의 영향을 받지 않는다
 * @param lastSessionDate  마지막으로 집중한 날. 기록이 없으면 null
 */
public record StreakResponse(
        int currentStreak,
        int longestStreak,
        LocalDate lastSessionDate
) {
}

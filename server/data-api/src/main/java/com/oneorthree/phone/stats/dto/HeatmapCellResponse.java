package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

/**
 * 히트맵 한 칸. 요청 기간의 모든 날짜가 한 칸씩 오므로, 집중 이력이 없는 날도 0 으로 채워진 칸으로 나온다.
 *
 * @param date                     이 칸의 날짜(KST 축)
 * @param totalFocusMinutes        그날 총 집중 분
 * @param sessionCount             그날 완료된 세션 수 — 같은 분량이라도 몰아서 했는지 쪼갰는지가 갈린다
 * @param focusGoalAchieved        그날 집중 목표(하한)를 넘었는지
 * @param actualScreenTimeMinutes  그날 실제 스크린타임 분
 * @param screenTimeGoalAchieved   그날 스크린타임 목표(상한) 이내였는지 — 집중과 달리 적을수록 달성이다
 */
public record HeatmapCellResponse(
        LocalDate date,
        int totalFocusMinutes,
        int sessionCount,
        boolean focusGoalAchieved,
        int actualScreenTimeMinutes,
        boolean screenTimeGoalAchieved
) {
}

package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

public record HeatmapCellResponse(
        LocalDate date,
        int totalFocusMinutes,
        int sessionCount,
        boolean focusGoalAchieved,
        int actualScreenTimeMinutes,
        boolean screenTimeGoalAchieved
) {
}

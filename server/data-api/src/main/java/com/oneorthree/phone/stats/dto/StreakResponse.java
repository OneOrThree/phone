package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

public record StreakResponse(
        int currentStreak,
        int longestStreak,
        LocalDate lastSessionDate
) {
}

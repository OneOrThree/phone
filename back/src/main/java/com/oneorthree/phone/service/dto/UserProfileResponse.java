package com.oneorthree.phone.service.dto;

import java.time.LocalDate;

public record UserProfileResponse(
        Long id,
        String nickname,
        String gender,
        LocalDate birthDate,
        String profileImageUrl,
        int currency,
        String currentTier,
        int dailyScreenTimeGoalMinutes,
        String timeZone,
        String dayResetTime
) {}

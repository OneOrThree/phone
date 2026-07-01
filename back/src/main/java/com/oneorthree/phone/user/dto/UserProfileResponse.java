package com.oneorthree.phone.user.dto;

import java.time.LocalDate;
import java.util.UUID;

public record UserProfileResponse(
        UUID id,
        String nickname,
        String gender,
        LocalDate birthDate,
        int currency,
        Integer currentTier,
        int dailyScreenTimeGoalMinutes,
        int dailyFocusTimeGoalMinutes,
        String countryCode,
        String reportTime
) {}

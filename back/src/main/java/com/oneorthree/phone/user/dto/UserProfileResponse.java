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
        String timeZone,
        String dayStartTime,
        String dayEndTime,
        String reportTime
) {}

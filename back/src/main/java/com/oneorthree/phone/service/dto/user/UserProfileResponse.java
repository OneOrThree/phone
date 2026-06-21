package com.oneorthree.phone.service.dto.user;

import java.time.LocalDate;
import java.util.UUID;

public record UserProfileResponse(
        UUID id,
        String nickname,
        String gender,
        LocalDate birthDate,
        String profileImageUrl,
        int currency,
        String currentTier,
        int dailyScreenTimeGoalMinutes,
        String timeZone,
        String dayStartTime,
        String dayEndTime,
        String reportTime
) {}

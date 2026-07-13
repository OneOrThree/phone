package com.oneorthree.phone.user.dto;

import java.util.UUID;

public record UserProfileResponse(
        UUID id,
        String nickname,
        int currency,
        int dailyScreenTimeGoalMinutes,
        int dailyFocusTimeGoalMinutes,
        String countryCode,
        String statVisibility,
        String occupation
) {}

package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileUpdateRequest {
    String nickname;

    @PositiveOrZero
    Integer dailyScreenTimeGoalMinutes;

    @PositiveOrZero
    Integer dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;
}

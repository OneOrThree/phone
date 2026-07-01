package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.domain.Gender;
import com.oneorthree.phone.user.domain.Occupation;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileSetupRequest {
    String nickname;
    LocalDate birthDate;
    Gender gender;
    Occupation occupation;

    @PositiveOrZero
    int dailyScreenTimeGoalMinutes;

    @PositiveOrZero
    int dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;

    String reportTime;
}

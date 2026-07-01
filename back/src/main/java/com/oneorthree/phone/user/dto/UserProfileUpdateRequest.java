package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.domain.Gender;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileUpdateRequest {
    String nickname;
    LocalDate birthDate;
    Gender gender;
    Integer dailyScreenTimeGoalMinutes;
    Integer dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;

    String reportTime;
}

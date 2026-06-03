package com.oneorthree.phone.api.dto.request;

import com.oneorthree.phone.domain.user.Gender;
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
    String timeZone;
    String dayStartTime;
    String dayEndTime;
    String reportTime;
}

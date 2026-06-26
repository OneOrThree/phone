package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.domain.Gender;
import com.oneorthree.phone.user.domain.Occupation;
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
    int dailyScreenTimeGoalMinutes;
    String timeZone;
    String dayStartTime;
    String dayEndTime;
    String reportTime;
}

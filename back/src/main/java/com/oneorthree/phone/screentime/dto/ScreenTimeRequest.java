package com.oneorthree.phone.screentime.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class ScreenTimeRequest {

    @NotNull
    private Boolean screenTimeGoalAchieved;

    // nullable — iOS 개발 완료 후 채워짐
    private Integer actualScreenTimeMinutes;

    @NotNull
    private Instant reportedAt;

    @NotBlank
    private String timeZone;
}

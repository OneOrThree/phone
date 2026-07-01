package com.oneorthree.phone.screentime.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
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
    @PositiveOrZero
    private Integer actualScreenTimeMinutes;

    @NotNull
    private Instant reportedAt;
}

package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class ScreenTimeGoalUpdateRequest {

    @NotNull
    @PositiveOrZero
    private Integer dailyScreenTimeGoalMinutes;
}

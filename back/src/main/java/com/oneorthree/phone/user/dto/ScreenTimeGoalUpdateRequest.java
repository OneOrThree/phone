package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class ScreenTimeGoalUpdateRequest {

    // 상한 24h(GROMO-1049) — 집중 목표와 같은 이유. 큰 값일수록 지급액이 커지는 공식이라
    // 상한이 없으면 비현실적 목표로 최상위 구간을 노릴 여지도 남는다.
    @NotNull
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    private Integer dailyScreenTimeGoalMinutes;
}

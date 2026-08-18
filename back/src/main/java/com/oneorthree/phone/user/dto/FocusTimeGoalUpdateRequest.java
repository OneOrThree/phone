package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class FocusTimeGoalUpdateRequest {

    // 상한 24h(GROMO-1049) — 상한이 없으면 Integer.MAX_VALUE 같은 값이 저장돼 달성 판정의
    // goal*60 곱이 오버플로되고, 지급 가드(24h)에도 걸려 목표만 오염된 채 남는다.
    @NotNull
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    private Integer dailyFocusTimeGoalMinutes;
}

package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 일일 집중 목표(분) 변경 요청.
 *
 * <p>목표는 달성 판정과 보상 지급의 분모라 상한이 필수다. 변경 시 서버가 직전 값을 <b>하루치만</b>
 * 보존하므로, 지연 업로드된 어제 세션은 어제의 목표로 판정된다.
 */
@Getter
@NoArgsConstructor
public class FocusTimeGoalUpdateRequest {

    /**
     * 상한 24h(GROMO-1049) — 상한이 없으면 Integer.MAX_VALUE 같은 값이 저장돼 달성 판정의
     * goal*60 곱이 오버플로되고, 지급 가드(24h)에도 걸려 목표만 오염된 채 남는다.
     */
    @NotNull
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    private Integer dailyFocusTimeGoalMinutes;
}

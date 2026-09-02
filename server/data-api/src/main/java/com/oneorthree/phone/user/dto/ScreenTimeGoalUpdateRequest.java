package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 일일 스크린타임 목표(분) 변경 요청.
 *
 * <p>집중 목표와 달리 <b>덜 쓸수록 달성</b>이라 목표를 크게 잡을수록 지급이 커지는 방향이다 —
 * 상한이 그 남용을 자른다. 서버는 직전 값을 하루치만 보존한다.
 */
@Getter
@NoArgsConstructor
public class ScreenTimeGoalUpdateRequest {

    /**
     * 상한 24h(GROMO-1049) — 집중 목표와 같은 이유. 큰 값일수록 지급액이 커지는 공식이라
     * 상한이 없으면 비현실적 목표로 최상위 구간을 노릴 여지도 남는다.
     */
    @NotNull
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    private Integer dailyScreenTimeGoalMinutes;
}

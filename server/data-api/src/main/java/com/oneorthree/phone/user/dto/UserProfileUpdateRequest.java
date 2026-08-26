package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileUpdateRequest {
    String nickname;

    /**
     * 목표 상한 24h(GROMO-1049) — 전용 갱신 API와 같은 제약을 이 경로에도 건다.
     */
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    Integer dailyScreenTimeGoalMinutes;

    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    Integer dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;
}

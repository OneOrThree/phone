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

    // GROMO-805: 서버가 목표 달성을 직접 판정하므로(actual <= goal) 이 클라 필드는 더 이상 신뢰하지 않는다(deprecated).
    // 구버전 앱 호환을 위해 필드는 유지(@NotNull)하되 저장·알림·이벤트는 서버 판정값을 쓴다.
    @Deprecated
    @NotNull
    private Boolean screenTimeGoalAchieved;

    // nullable — iOS 개발 완료 후 채워짐
    @PositiveOrZero
    private Integer actualScreenTimeMinutes;

    @NotNull
    private Instant reportedAt;
}

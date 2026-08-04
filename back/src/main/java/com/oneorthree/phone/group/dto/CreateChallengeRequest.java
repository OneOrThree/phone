package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
public class CreateChallengeRequest {
    @NotNull
    private MissionCategory missionCategory;
    @NotNull
    private MissionType missionType;
    // DURATION: 하루 목표 분(필수) · TIME_WINDOW: 창 내 목표 분(필수, 0 < x ≤ 창 길이 분).
    private Integer durationMinutes;
    // TIME_WINDOW 전용 — Asia/Seoul 벽시계 시각(time-of-day)만 의미(GROMO-1100). 시작 > 종료는 자정 걸침 창으로 허용.
    private Instant windowStart;
    private Instant windowEnd;
}

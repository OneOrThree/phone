package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class CreateChallengeRequest {
    @NotNull
    private MissionCategory missionCategory;
    @NotNull
    private MissionType missionType;
    /**
     * 도는 요일 (GROMO-1260) — <b>필수, 1개 이상</b>. 3글자 ISO 약어({@code ["MON","WED","FRI"]}) 권장,
     * 전체 이름({@code "MONDAY"})·대소문자 혼용도 수용한다. 파싱은
     * {@link com.oneorthree.phone.group.domain.RepeatSchedule#maskOf} 단일 입구.
     *
     * <p><b>기본값이 없다</b> — 비어 있으면 {@code CHALLENGE_REPEAT_DAYS_REQUIRED} 400 이고,
     * 알 수 없는 표기는 {@code INVALID_MISSION_PARAMS} 400 이다(정책 §A3).
     */
    private List<String> repeatDays;

    // DURATION: 하루 목표 분(필수) · TIME_WINDOW: 창 내 목표 분(필수, 0 < x ≤ 창 길이 분).
    private Integer durationMinutes;
    // TIME_WINDOW 전용 — Asia/Seoul 벽시계 시각(time-of-day)만 의미(GROMO-1100). 시작 > 종료는 자정 걸침 창으로 허용.
    // 표기는 "HH:mm:ss" 권장(신앱)·구앱 ISO Instant 도 수용 — 파싱은 WindowFocusAggregator.parseRequestTime
    // 단일 입구를 거치고, 형식 오류는 INVALID_MISSION_PARAMS 다(GROMO-1225).
    private String windowStart;
    private String windowEnd;
}

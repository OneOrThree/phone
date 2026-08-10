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
    // 도는 요일(§A3 · GROMO-1260) — 신앱은 1개 이상 필수(빈 배열 = CHALLENGE_REPEAT_DAYS_REQUIRED 400).
    // 구앱 호환: 필드 미전송(null)이면 서버가 매일(127)로 접는다 — UI 는 선택을 강제하고 서버는 관대하게.
    private List<RepeatDay> repeatDays;
    // DURATION: 하루 목표 분(필수, 카테고리별 상한 — FOCUS 1080·SCREEN_TIME 720, N51)
    // TIME_WINDOW: 창 내 목표 분(필수, 0 < x ≤ 창 길이 분 · FOCUS 는 >5분(N31) · SCREEN_TIME 은 15분 배수).
    private Integer durationMinutes;
    // TIME_WINDOW 전용 — KST 벽시계 시각. 자정 걸침 금지: 시작 < 종료만 허용(§A6-1 · GROMO-1406).
    // 표기는 "HH:mm:ss" 권장(신앱)·구앱 ISO Instant 도 수용 — 파싱은 WindowFocusAggregator.parseRequestTime
    // 단일 입구를 거치고, 형식 오류는 INVALID_MISSION_PARAMS 다(GROMO-1225).
    private String windowStart;
    private String windowEnd;
    // 내기(GROMO-1410·N26) — 생성 시에만 결정하고 이후 불변(끄려면 삭제 후 재생성). 미전송(null)이면
    // 내기 없음. 켜진 생성이면 설정 생성 + N35 조건 충족 시 당일 회차 개설까지 같은 트랜잭션에서 처리.
    private BetCreateRequest bet;

    /** 생성 시 내기 지정 — 앱 계약은 {@code bet:{enabled,stake}}. stake 는 1~3,000(N30). */
    @Getter
    @NoArgsConstructor
    public static class BetCreateRequest {
        private boolean enabled;
        private Integer stake;
    }
}

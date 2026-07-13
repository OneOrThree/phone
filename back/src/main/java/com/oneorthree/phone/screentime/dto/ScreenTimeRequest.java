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

    // GROMO-805: 최종 보고(finalReport)에서는 클라가 '당시' 목표·하루 전체 데이터로 계산한 이 달성 결과를 신뢰해
    // 저장·알림·이벤트에 그대로 쓴다(서버는 과거 날짜의 당시 목표를 몰라 재판정 불가). interim(오늘)은 total 만 갱신한다.
    @NotNull
    private Boolean screenTimeGoalAchieved;

    // nullable — iOS 개발 완료 후 채워짐
    @PositiveOrZero
    private Integer actualScreenTimeMinutes;

    @NotNull
    private Instant reportedAt;

    /**
     * 하루 최종 보고(23:59)면 true, 중간 동기화면 false/생략.
     * 최종 보고에서만 목표 달성 알림을 발사한다(중간 동기화 조기 알림 방지). nullable(구버전 앱 호환).
     */
    private Boolean isFinal;
}

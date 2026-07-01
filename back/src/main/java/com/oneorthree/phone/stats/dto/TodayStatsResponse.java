package com.oneorthree.phone.stats.dto;

/**
 * 오늘 요약 조회 응답 (집중·스크린타임 통합).
 * 홈 요약카드 / 포커스 오늘통계 / 통계 간단통계 공용.
 * 데이터 없을 시 각 값은 0 / 미달성(false).
 */
public record TodayStatsResponse(
        FocusStat focus,
        ScreenTimeStat screenTime
) {

    /** 집중: 목표(분 이상) 대비 오늘 누적 집중 시간. */
    public record FocusStat(
            int todayMinutes,
            int goalMinutes,
            boolean goalAchieved,
            int progressPercent
    ) {
    }

    /** 스크린타임: 목표(분 이내) 대비 오늘 실제 사용량. progressPercent 는 100 초과 가능(초과 노출). */
    public record ScreenTimeStat(
            int todayMinutes,
            int goalMinutes,
            boolean goalAchieved,
            int progressPercent
    ) {
    }
}

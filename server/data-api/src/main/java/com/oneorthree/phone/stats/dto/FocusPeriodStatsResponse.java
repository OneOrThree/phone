package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

/**
 * 기간별 집중 시간 통계 응답.
 * 현재 구간 집중 시간·직전 동일 길이 구간 집중 시간·차이(delta)를 포함한다.
 * 퍼센트 계산은 클라이언트가 담당(서버는 분 단위 숫자만 반환).
 */
public record FocusPeriodStatsResponse(
        /** 조회한 기간 종류 (DAY | WEEK | MONTH). */
        StatsPeriod period,
        /** 현재 구간 시작일 (UTC). */
        LocalDate from,
        /** 현재 구간 종료일 (UTC, = 오늘). */
        LocalDate to,
        /** 현재 구간 누적 집중 시간(분). */
        int totalFocusMinutes,
        /** 직전 동일 길이 구간 누적 집중 시간(분). */
        int previousTotalFocusMinutes,
        /** totalFocusMinutes - previousTotalFocusMinutes (음수 가능). */
        int deltaMinutes
) {
}

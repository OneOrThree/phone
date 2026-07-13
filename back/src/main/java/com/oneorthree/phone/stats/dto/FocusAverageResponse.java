package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

/**
 * 기간별 평균 집중시간 집계 응답 (GROMO-753).
 *
 * <p>모수(scope) 유저 중 해당 기간 활동(row&ge;1) 유저의 집중 초 합을 활동 유저 수로 나눈 뒤 분 내림한 값.
 * 무활동/모수 없음/occupation 미설정이면 {@code averageMinutes = null}, {@code sampleSize = 0}.
 */
public record FocusAverageResponse(
        /** 집계 모수 종류 (FRIENDS | TOTAL | CATEGORY). */
        FocusAverageScope scope,
        /** 조회한 기간 종류 (DAY | WEEK | MONTH). */
        StatsPeriod period,
        /** 집계 구간 시작일(클라 로컬 기준). */
        LocalDate from,
        /** 집계 구간 종료일(= 기준일). */
        LocalDate to,
        /** 활동 유저 1인당 평균 집중 시간(분, 내림). null = 미설정/무활동(클라는 해당 축 숨김). */
        Integer averageMinutes,
        /** 평균에 든 활동 유저 수(클라 "N명 평균" 표기용). 무활동/모수 없음이면 0. */
        int sampleSize
) {
}

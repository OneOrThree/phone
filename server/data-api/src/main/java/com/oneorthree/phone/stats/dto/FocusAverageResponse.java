package com.oneorthree.phone.stats.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.LocalDate;

/**
 * 기간별 평균 집중시간 집계 응답 (GROMO-753).
 *
 * <p>모수(scope) 유저 중 해당 기간 활동(row&ge;1) 유저의 집중 초 합을 활동 유저 수로 나눈 뒤 분 내림한 값.
 * 무활동/모수 없음/occupation 미설정이면 {@code averageMinutes = null}, {@code sampleSize = 0}.
 *
 * <p>{@code averageMinutes} 가 null 이면 JSON 에서 필드 자체를 생략(NON_NULL) — "데이터 없으면 필드 숨김"
 * 의도를 정직하게 반영(클라는 해당 축 미표시). null 을 명시 직렬화하지 않음.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FocusAverageResponse(
        /** 집계 모수 종류 (FRIENDS | TOTAL | CATEGORY). */
        FocusAverageScope scope,
        /** 조회한 기간 종류 (DAY | WEEK | MONTH). */
        StatsPeriod period,
        /** 집계 구간 시작일(서버 판정 축 KST 고정 기준). */
        LocalDate from,
        /** 집계 구간 종료일(= 기준일). */
        LocalDate to,
        /** 활동 유저 1인당 평균 집중 시간(분, 내림). null = 미설정/무활동(클라는 해당 축 숨김). */
        Integer averageMinutes,
        /** 평균에 든 활동 유저 수(클라 "N명 평균" 표기용). 무활동/모수 없음이면 0. */
        int sampleSize
) {
}

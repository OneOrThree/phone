package com.oneorthree.phone.focus.repository;

/**
 * 평균 집중시간 계산용 집계 중간값 — JPQL 생성자 표현식(SELECT new ...)의 결과 타입 (GROMO-753).
 *
 * <p>{@code stats/dto} 에 있다가 {@code focus/repository} 로 왔다 (GROMO-1656) — API 응답 타입이
 * 아니라 {@code DailyFocusStat} 조회의 <b>프로젝션</b>이라 리포지토리를 따라간다. 이 클래스의
 * FQCN 은 {@code @Query} 문자열 안에도 박혀 있으므로 옮길 때 함께 고쳐야 한다(컴파일러가 잡지 못한다).
 *
 * <p>기간 내 모수 유저들의 집중 초 총합과 활동(row&ge;1) 유저 수를 담는다.
 * 평균은 서비스에서 {@code floor(totalSeconds / activeUserCount / 60)} 로 산출한다.
 *
 * @param totalSeconds     기간 내 모수 유저 집중 초 총합(COALESCE(SUM, 0) — 무데이터면 0)
 * @param activeUserCount  기간 내 활동한 서로 다른 유저 수(COUNT(DISTINCT user))
 */
public record FocusAverageAggregate(long totalSeconds, long activeUserCount) {
}

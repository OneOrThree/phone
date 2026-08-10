package com.oneorthree.phone.group.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/**
 * {@code join-week} 요청 본문(GROMO-1408, LLD §2.2) — <b>선택</b>이다. {@code sessionDates} 를 주면
 * 그 날짜만 부분 예약하고(§C2 「2일만 참여」), 생략(본문 없음 포함)하면 이번 주(월~일) 남은 활성일
 * 전부다. 지정 시엔 비어 있지 않은 서로 다른 날짜 집합이어야 하며 전부 이번 주 남은 활성일이어야
 * 한다 — 위반은 {@code INVALID_SESSION_DATES} 400 (부분 성공을 만들지 않는다).
 */
@Getter
@NoArgsConstructor
public class JoinWeekRequest {

    private List<LocalDate> sessionDates;
}

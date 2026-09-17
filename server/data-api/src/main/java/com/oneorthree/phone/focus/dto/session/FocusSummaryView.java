package com.oneorthree.phone.focus.dto.session;

import java.time.Instant;
import java.time.LocalDate;

/**
 * {@code GET /me/focus-summary} 응답 (GROMO-1764, LLD §2 home-summary).
 *
 * @param date                       조회한 KST 날짜
 * @param completedSeconds           그 날짜에 귀속된 완료 세션의 순수 집중 초 합(기존 KST net 집계)
 * @param currentSessionSecondsToday 진행 중 세션의 ACTIVE 구간과 그 날짜의 교집합
 * @param totalSeconds               completedSeconds + currentSessionSecondsToday
 * @param serverNow                  같은 읽기 snapshot의 서버 시각
 */
public record FocusSummaryView(
        LocalDate date,
        long completedSeconds,
        long currentSessionSecondsToday,
        long totalSeconds,
        Instant serverNow) {
}

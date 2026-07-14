package com.oneorthree.phone.focus.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 라이브 집중 세션 종료 응답(GROMO-610).
 *
 * <p>완료된 세션 요약을 반환해 클라가 즉시 통계에 반영할 수 있게 한다.
 *
 * @param sessionId               종료된 세션 id
 * @param startedAt               시작 시각(기존 값)
 * @param endedAt                 채워진 종료 시각
 * @param durationSeconds         지속 시간(초) = endedAt - startedAt
 * @param totalDistractionSeconds 최종 방해 초
 * @param dayTotalFocusSeconds    이 세션 반영 후 그날 누적 집중 초(GROMO-806, additive)
 * @param streakQualifiedToday    그날 누적이 스트릭 인정 기준(10분) 이상이라 스트릭이 인정됐는지(GROMO-806, additive)
 */
public record FocusSessionEndResponse(
        UUID sessionId,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        int totalDistractionSeconds,
        int dayTotalFocusSeconds,
        boolean streakQualifiedToday
) {
}

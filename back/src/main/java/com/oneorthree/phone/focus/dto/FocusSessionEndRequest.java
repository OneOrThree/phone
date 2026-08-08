package com.oneorthree.phone.focus.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * 라이브 집중 세션 종료 요청(GROMO-610).
 *
 * <p>진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리한다.
 *
 * @param sessionId               종료할 진행 중 세션 id(필수)
 * @param endedAt                 종료 시각(선택). null 이면 서버 수신 시각(Instant.now). startedAt 이후여야 함
 * @param totalDistractionSeconds 세션 중 누적 방해 초(선택, 미지정 시 0). 0 이상 24시간 이하
 * @param focusTagId              시작 시 미지정한 태그 보정용(user_focus_tags.id, 선택). 소유 태그여야 함
 * @param focusSecondsByDate      GROMO-1252: 날짜별 집중 초(로컬 날짜 → 초, 선택). 자정을 걸친 세션의 날짜별
 *                                귀속 근거 — null·빈 맵이면 서버 벽시계 분할로 폴백한다.
 *                                상세 계약은 {@link FocusSessionRequest#focusSecondsByDate} 참고
 */
public record FocusSessionEndRequest(
        @NotNull UUID sessionId,
        Instant endedAt,
        // GROMO-1214 코드리뷰(돈 경로): 음수 금지. 세션 보상이 (endedAt − startedAt) − totalDistractionSeconds 라
        // 음수를 보내면 집중초가 늘어나, 방금 발급한 몇 초짜리 마커로도 12시간 캡(720코인)까지 긁을 수 있었다.
        // 같은 값이 방해 통계(daily_focus_stats)에도 그대로 누적되므로 상한도 함께 둔다.
        @PositiveOrZero
        @Max(value = 24 * 60 * 60, message = "하루 24시간을 넘을 수 없습니다")
        int totalDistractionSeconds,
        UUID focusTagId,
        Map<LocalDate, Integer> focusSecondsByDate
) {
    /** 하위호환 — focusSecondsByDate 미지정 기존 4-arg 호출부(null → 서버 벽시계 분할 폴백). */
    public FocusSessionEndRequest(UUID sessionId, Instant endedAt, int totalDistractionSeconds, UUID focusTagId) {
        this(sessionId, endedAt, totalDistractionSeconds, focusTagId, null);
    }
}

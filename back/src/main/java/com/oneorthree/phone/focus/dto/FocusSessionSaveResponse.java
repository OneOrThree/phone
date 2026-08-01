package com.oneorthree.phone.focus.dto;

/**
 * 집중 세션 완료 저장 응답(POST {@code /api/v1/focus-session}, GROMO-806).
 *
 * <p>기존에는 201 + 빈 바디였으나, 세션완료 후 그날 누적·스트릭 인정 여부를 클라가 즉시 반영할 수 있도록
 * 바디를 추가한다. 빈 바디 → 바디 추가는 additive 변경이라 구버전 앱은 무시한다(PATCH 종료 응답과 필드 통일).
 *
 * @param dayTotalFocusSeconds 이 세션 반영 후 그날 누적 집중 초
 * @param streakQualifiedToday 그날 누적이 스트릭 인정 기준(10분) 이상이라 스트릭이 인정됐는지
 * @param goalRewardCoins      이 세션으로 집중 목표를 처음 달성했을 때의 지급액(전이 없으면 0)
 */
public record FocusSessionSaveResponse(
        int dayTotalFocusSeconds,
        boolean streakQualifiedToday,
        int goalRewardCoins
) {
}

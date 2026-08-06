package com.oneorthree.phone.focus.dto;

/**
 * 집중 세션 완료 저장 응답(POST {@code /api/v1/focus-session}, GROMO-806).
 *
 * <p>기존에는 201 + 빈 바디였으나, 세션완료 후 그날 누적·스트릭 인정 여부를 클라가 즉시 반영할 수 있도록
 * 바디를 추가한다. 빈 바디 → 바디 추가는 additive 변경이라 구버전 앱은 무시한다(PATCH 종료 응답과 필드 통일).
 *
 * <p>awardedCoins 는 currency 폐쇄(서버 지급 전환) 필드 — 이 세션 저장으로 서버가 지급한 코인 수.
 * 구버전 앱은 무시하고(additive), 신버전 앱은 이 값으로 로컬 잔액을 갱신한다(/currency/earn 호출 제거).
 *
 * <p>balanceAfter 는 이 저장 트랜잭션이 끝난 뒤의 <b>잔액 정본</b>(GROMO-1049). 앱은 지급 응답이
 * 오기 전에 화면 잔액을 미리 올리는데(낙관 가산), 그동안 떠 있던 {@code GET /currency} 응답이
 * 지급 전 스냅샷인지 후인지 앱이 알 수 없어 낙관분이 지워지거나 이중으로 더해지는 경합이 있었다.
 * 서버가 지급 직후 잔액을 함께 주면 앱은 추측 없이 이 값을 그대로 쓰면 된다.
 *
 * @param dayTotalFocusSeconds 이 세션 반영 후 그날 누적 집중 초
 * @param streakQualifiedToday 그날 누적이 스트릭 인정 기준(10분) 이상이라 스트릭이 인정됐는지
 * @param awardedCoins         이 세션 저장으로 서버가 지급한 코인 수(집중 60초당 1코인, 0 이면 미지급)
 * @param goalRewardCoins      이 세션으로 집중 목표를 처음 달성했을 때의 지급액(전이 없으면 0)
 * @param balanceAfter         이 저장 트랜잭션 반영 후 잔액(지급이 0 이어도 현재 잔액을 싣는다)
 */
public record FocusSessionSaveResponse(
        int dayTotalFocusSeconds,
        boolean streakQualifiedToday,
        int awardedCoins,
        int goalRewardCoins,
        int balanceAfter
) {
}

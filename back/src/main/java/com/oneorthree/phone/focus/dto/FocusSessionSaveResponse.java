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
 * @param dayTotalFocusSeconds 이 세션 반영 후 그날 누적 집중 초
 * @param streakQualifiedToday 그날 누적이 스트릭 인정 기준(10분) 이상이라 스트릭이 인정됐는지
 * @param awardedCoins         이 세션 저장으로 서버가 지급한 코인 수(집중 60초당 1코인, 0 이면 미지급)
 * <p>balanceAfter 는 이 저장 트랜잭션 반영 후 잔액이다. <b>현재 앱은 쓰지 않는다</b> — 잔액은
 * GET /currency 재조회로 통일했다(GROMO-1049). 다만 직전 번들이 대기열 지급 반영에 이 값만
 * 쓰고 flush 후 재조회를 하지 않으므로, 롤링 호환을 위해 계속 실어 준다(additive, 제거 시 그
 * 번들에서 대기열 지급이 다음 조회 전까지 화면에 안 뜬다 — 코드리뷰).</p>
 *
 * @param goalRewardCoins      이 세션으로 집중 목표를 처음 달성했을 때의 지급액(전이 없으면 0)
 * @param balanceAfter         이 저장 트랜잭션 반영 후 잔액(구 번들 호환용, 현재 앱 미사용)
 */
public record FocusSessionSaveResponse(
        int dayTotalFocusSeconds,
        boolean streakQualifiedToday,
        int awardedCoins,
        int goalRewardCoins,
        int balanceAfter
) {
}

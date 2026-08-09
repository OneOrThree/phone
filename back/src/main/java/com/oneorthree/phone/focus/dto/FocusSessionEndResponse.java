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
 * <p>awardedCoins·goalRewardCoins·balanceAfter 는 GROMO-1214 에서 추가한 지급 필드로,
 * POST 응답({@link FocusSessionSaveResponse})과 <b>필드명·의미가 같다</b> — 앱이 두 경로를 같은 코드로 소비한다.
 *
 * @param dayTotalFocusSeconds    이 세션 반영 후 그날 누적 집중 초(GROMO-806, additive)
 * @param streakQualifiedToday    그날 누적이 스트릭 인정 기준(10분) 이상이라 스트릭이 인정됐는지(GROMO-806, additive)
 * @param awardedCoins            이 종료로 서버가 지급한 세션 보상 코인(집중 60초당 1코인, 0 이면 미지급)
 * @param goalRewardCoins         이 세션으로 집중 목표를 처음 달성했을 때의 지급액(전이 없으면 0)
 * @param balanceAfter            이 종료 트랜잭션 반영 후 잔액(POST 응답과 동일 — 구 번들 호환용)
 */
public record FocusSessionEndResponse(
        UUID sessionId,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        int totalDistractionSeconds,
        int dayTotalFocusSeconds,
        boolean streakQualifiedToday,
        int awardedCoins,
        int goalRewardCoins,
        int balanceAfter
) {
}

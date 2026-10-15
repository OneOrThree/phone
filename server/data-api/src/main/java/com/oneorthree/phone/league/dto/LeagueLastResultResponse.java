package com.oneorthree.phone.league.dto;

import java.time.Instant;

/**
 * 주간 리그 마감 결과 조회 응답 (GROMO-567).
 *
 * <p>주간 배치(GROMO-817)가 남긴 최신 정산 결과 1건을 노출한다. 결과 행이 없으면
 * {@code hasResult=false} 이고 나머지 필드는 null/false 다. 클라는 리그 탭 첫 진입 시
 * {@code hasResult && !acknowledged} 이면 결과 모달을 1회 노출하고, 닫을 때 ack 로 확인 처리한다.
 *
 * @param hasResult         최신 결과 행 존재 여부(미배정/신규 유저는 false)
 * @param weekStartAt       정산 대상 주차 시작 시각(결과 없음이면 null)
 * @param result            정산 결과 enum name(PROMOTED/STAY/RELEGATED, 결과 없음이면 null)
 * @param previousTierLevel 정산 전 티어(결과 없음이면 null)
 * @param newTierLevel      정산 후 티어(결과 없음이면 null)
 * @param focusSeconds       해당 주차 집중 시간(초, 결과 없음이면 null)
 * @param acknowledged       확인 처리 여부(acknowledgedAt != null)
 * @param promotionBonusCoins 승급(PROMOTED) 시 지급된 승급 보너스 코인(승급이 아니거나 결과 없음이면 0)
 */
public record LeagueLastResultResponse(
        boolean hasResult,
        Instant weekStartAt,
        String result,
        Integer previousTierLevel,
        Integer newTierLevel,
        Integer focusSeconds,
        boolean acknowledged,
        int promotionBonusCoins
) {
}

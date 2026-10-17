package com.oneorthree.phone.appearance.dto;

import com.oneorthree.phone.outbox.dto.EventEnvelope;

import java.util.List;

/**
 * 바다 집중 한 번의 정산 결과 (GROMO-2274) — 집중 종료 응답의 {@code seaReward} 가 되는 값이다.
 *
 * @param grantedProductIds 이번 정산으로 새로 개인 인벤토리에 들어간 상품. 단계를 넘지 않았거나 이미 가진
 *                          상품뿐이면 빈 목록이다(바다 세션이면 목록은 늘 있다 — 없는 것은 섬 세션이다)
 * @param minutesToNextTier 이번 정산까지 반영한 누적 기준, 두 세트(상시·이번 달 시즌)의 다음 단계 중 가장 가까운
 *                          것까지 남은 분. 더 받을 단계가 없으면 {@code null}
 * @param events            지급마다 적은 인벤토리 사건 봉투 — 호출측 명령의 receipt 에 그대로 싣는다
 *                          (docs/conventions/outbox-events.md §2.5). 응답에는 나가지 않는다
 */
public record SeaRewardResult(List<String> grantedProductIds, Integer minutesToNextTier,
                              List<EventEnvelope> events) {
}

package com.oneorthree.phone.appearance.dto;

import com.oneorthree.phone.outbox.dto.EventEnvelope;

import java.util.List;

/**
 * 집중 한 번이 뽑은 꾸미기 보상 (GROMO-2301) — 정산 행({@code focus_settlements})의 두 칸이 된다.
 *
 * @param revision  추첨에 쓴 정책 revision
 * @param productId 뽑힌 상품. 이미 가진 상품이어도 결과다(중복 획득 — 보유 행은 처음 한 번만 생긴다)
 * @param newlyOwned 이번 지급으로 보유 행이 새로 생겼는가 — 결과창의 NEW! 표시
 * @param events    처음 가졌을 때 적은 인벤토리 사건 봉투(0~1개) — 호출측 명령의 receipt 에 그대로 싣는다
 *                  (docs/conventions/outbox-events.md §2.5). 응답에는 나가지 않는다
 */
public record CustomizationRewardResult(int revision, String productId, boolean newlyOwned,
                                        List<EventEnvelope> events) {
}

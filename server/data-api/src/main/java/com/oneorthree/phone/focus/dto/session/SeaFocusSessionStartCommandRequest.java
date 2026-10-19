package com.oneorthree.phone.focus.dto.session;

import java.util.UUID;

/**
 * 바다 집중 세션 시작 본문 (GROMO-2299, 바다 항해 계약 §2).
 *
 * @param destinationIslandId 가려는 섬 — 지금 망원경 목록({@code TelescopeService.list})에 있는 섬이어야 한다
 */
public record SeaFocusSessionStartCommandRequest(UUID destinationIslandId) {
}

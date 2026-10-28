package com.oneorthree.phone.internal.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 섬의 오늘 집중 시간 (GROMO-2258) — 방문 화면({@code GET /screens/visit/{islandId}})의 {@code focusToday} 상류.
 *
 * @param islandId 섬
 * @param date     KST 오늘
 * @param minutes  그 섬 주민 세션(진행 중·완료)의 오늘 {@code [00:00 KST, 지금)} 순수 집중 합, 분 내림
 */
public record IslandFocusTodayView(UUID islandId, LocalDate date, long minutes) {
}

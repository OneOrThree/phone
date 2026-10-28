package com.oneorthree.phone.appearance.dto;

import java.util.List;

/**
 * GET /islands/{islandId}/inventory 내부 응답 — 공동 소유 상품을 종류별로 돌려준다.
 * buildingThemes 항목은 대상 건물을 함께 실어야 계약의 건물별 테마 목록이 성립한다.
 */
public record SharedInventoryView(
        List<String> audio,
        List<String> islandThemes,
        List<BuildingThemeItem> buildingThemes,
        long inventoryVersion,
        IslandAppearanceView appearance) {

    /** 건물 전용 테마 1건 — 건물 ID 오름차순으로 정렬된다. */
    public record BuildingThemeItem(String buildingId, String themeId) {
    }
}

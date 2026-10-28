package com.oneorthree.phone.appearance.dto;

import java.util.Map;

/**
 * 공동 외양 전체 맵 스냅샷 — GET inventory 의 appearance 와 PATCH data 가 공유한다.
 * buildingThemes 는 완공된 건물 키만 담고 값은 "default" 또는 building_theme 상품 ID다.
 * version 은 islands_appearance_version 축이다.
 */
public record IslandAppearanceView(
        String islandThemeId,
        Map<String, String> buildingThemes,
        long version) {
}

package com.oneorthree.phone.appearance.dto;

import java.util.List;

/**
 * GET /me/inventory 내부 응답 — clothes·decor 은 ownerType=user 인 소유 상품을 productId 로 정렬해
 * 돌려주고, hulls 는 소유가 아닌 상수 집합 ["raft"] 다(유료 선체 폐지 — GROMO-1851). inventoryVersion 은
 * 개인 인벤토리 변경이 발행하는 USER_INVENTORY 축의 마지막 버전이다.
 */
public record PersonalInventoryView(
        List<String> clothes,
        List<String> decor,
        List<String> hulls,
        long inventoryVersion,
        PersonalAppearanceView equipped) {
}

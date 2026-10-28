package com.oneorthree.phone.internal.dto;

/**
 * {@code PATCH /internal/islands/{islandId}/quests/{questId}} 요청 본문 (GROMO-1773). 둘 중 하나 이상 —
 * null 은 «유지»다(공개 계약의 명시 null 거절은 Business 가 한다).
 */
public record QuestUpdateRequest(String title, Integer targetMinutes) {
}

package com.oneorthree.phone.internal.dto;

/**
 * {@code POST /internal/islands/{islandId}/quests} 요청 본문 (GROMO-1773, island-quests LLD §2).
 * 필수·형식·범위 판정은 전부 Data 서비스가 한다 — 여기서 bean 검증으로 나누면 같은 규칙이 두 곳에 산다.
 * {@code windowStart}·{@code windowEnd} 는 UTC {@code HH:mm}(focus 전용), {@code timezone} 은 생략 또는 UTC.
 */
public record QuestCreateRequest(String title, String type, Integer targetMinutes, String windowStart,
                                 String windowEnd, String timezone) {
}

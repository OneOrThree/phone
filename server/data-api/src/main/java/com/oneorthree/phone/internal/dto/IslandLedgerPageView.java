package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/resources/ledger} 한 페이지 (GROMO-1895, 섬 건설 LLD §6) — 섬 공동 가계부.
 *
 * <p>{@code earnedTotal}·{@code spentTotal} 은 요청 월 전체의 합이다 — 방향 필터·페이지와 무관하다.
 * {@code nextCreatedAt}·{@code nextEntryId} 는 Business 가 서명 커서로 감싸는 평문 경계다(최신순).
 *
 * @param month 조회한 달 {@code YYYY-MM} (KST 달력 월)
 */
public record IslandLedgerPageView(String month, long earnedTotal, long spentTotal, List<Entry> items,
                                   Instant nextCreatedAt, UUID nextEntryId) {

    /**
     * 원장 한 줄 — {@code amount} 는 항상 양수이고 부호 대신 {@code direction} 이 방향을 말한다.
     *
     * @param direction {@code earn|spend}
     * @param reason {@code contribution|construction_debit}
     */
    public record Entry(UUID id, String direction, String reason, int amount, Instant createdAt) {
    }
}

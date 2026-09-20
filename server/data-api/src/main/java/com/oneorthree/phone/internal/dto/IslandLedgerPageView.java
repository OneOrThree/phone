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
     * 가계부 한 줄 — {@code amount} 는 항상 양수이고 부호 대신 {@code direction} 이 방향을 말한다.
     *
     * <p><b>집중 적립({@code contribution})은 하루 단위로 묶인 줄</b>이다(GROMO-1990) — 보상이 매분
     * 적립으로 바뀌어 건별로 내보내면 한 달이 수천 줄이 되기 때문이다. 원장 자체는 건별로 남아 있고
     * 묶는 것은 이 조회뿐이다. 그 밖의 사유는 언제나 한 건이 한 줄이다.
     *
     * @param direction {@code earn|spend}
     * @param reason {@code contribution|quest_settlement|construction_debit|shop_purchase}
     * @param amount 묶음이면 그 하루의 합, 아니면 그 한 건의 금액
     * @param createdAt 묶음이면 그 하루의 <b>첫</b> 기입 시각, 아니면 그 한 건의 시각(정렬·커서 축)
     * @param groupedUntil 묶음이면 그 하루의 <b>마지막</b> 기입 시각, 아니면 {@code createdAt} 과 같다
     * @param entryCount 이 줄이 접고 있는 원장 행 수 — 묶이지 않은 줄은 1 이다(널이 아니다)
     */
    public record Entry(UUID id, String direction, String reason, int amount, Instant createdAt,
                        Instant groupedUntil, int entryCount) {
    }
}

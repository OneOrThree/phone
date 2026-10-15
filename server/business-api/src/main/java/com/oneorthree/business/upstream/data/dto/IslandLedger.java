package com.oneorthree.business.upstream.data.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 공동 가계부 한 쪽의 상류 응답 (GROMO-1895, island-construction LLD §6) — Data 의
 * {@code IslandLedgerPageView} 와 같은 모양이다.
 *
 * <p>{@code earnedTotal}·{@code spentTotal} 은 요청 월 <b>전체</b>의 합이라 방향 필터·페이지와 무관하다.
 * {@code nextCreatedAt}·{@code nextEntryId} 는 평문 keyset 경계이고, 공개로 나갈 때
 * {@code IslandRecordsUseCase} 가 서명 커서로 감싼다 — 앱에 원장 행 id 를 그대로 주지 않는다.
 */
public record IslandLedger(String month, long earnedTotal, long spentTotal, List<Entry> items,
        Instant nextCreatedAt, UUID nextEntryId) {

    /**
     * 가계부 한 줄 — 공개 모양과 같아 그대로 싣는다. {@code amount} 는 항상 양수이고 방향은
     * {@code direction} 이 말한다.
     *
     * <p>집중 적립({@code contribution})은 하루 단위로 접힌 줄이다(GROMO-1990) — 보상이 매분 적립이라
     * 건별로 내보내면 한 달이 수천 줄이 된다. {@code entryCount} 가 그 줄이 접은 원장 행 수다.
     *
     * <p><b>거래 주체(누가 넣었는지)는 없다.</b> 주민별 기여는 도서관 완공 뒤에만 열리는
     * {@code statistics/fish-earnings} 의 몫이라(정책 「물고기 재화와 기록」), 가계부 줄에 주체를 달면
     * 그 게이트를 우회하게 된다.
     */
    public record Entry(UUID id, String direction, String reason, int amount, Instant createdAt,
            Instant groupedUntil, int entryCount) {
    }
}

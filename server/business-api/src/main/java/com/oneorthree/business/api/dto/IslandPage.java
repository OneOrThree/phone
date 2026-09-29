package com.oneorthree.business.api.dto;

import com.oneorthree.business.api.dto.IslandMembershipResponses.IslandSummaryView;

import java.util.List;

/**
 * 공개 목록 한 페이지 (GROMO-1759) — {@code GET /islands}·{@code GET /islands/discover} 공용.
 *
 * <p>{@code nextCursor} 는 사용자·필터·정렬·limit 에 묶인 서명 토큰이다. 없으면 null 이고, 빈 결과는
 * {@code items=[]}·{@code nextCursor=null} 이다(LLD §3.3).
 */
public record IslandPage(List<IslandSummaryView> items, String nextCursor) {
}

package com.oneorthree.business.upstream.data.dto;

import java.util.List;

/**
 * 주간 섬 랭킹의 상류 응답 (GROMO-1997, island-rankings LLD §2). 주는 <b>주 시작일</b>({@code YYYY-MM-DD} 인
 * UTC 일요일)이고 {@code asOf} 는 UTC instant 문자열이다 — 형식을 다시 쓰지 않고 그대로 내보낸다.
 *
 * <p>개인정보가 없다 — 섬 이름과 평균 초뿐이다. 항목은 Business 공개 DTO로 변환한 뒤 응답에 싣는다.
 */
public final class IslandRankingViews {

    private IslandRankingViews() {
    }

    /**
     * @param week   Data 가 집계한 주 — 요청과 대조한다. 다르면 상류 계약 위반이다
     * @param myRank 요청자의 현재 섬 순위. 이번 주 랭킹에 참가하지 않으면 {@code null} 이다
     */
    public record IslandRankingPage(String week, List<IslandRanking> items, Integer myRank, String asOf) {
    }

    /** 섬 한 줄 — 공개 {@code items[]} 와 같다. */
    public record IslandRanking(int rank, String islandId, String name, long averageFocusSeconds) {
    }
}

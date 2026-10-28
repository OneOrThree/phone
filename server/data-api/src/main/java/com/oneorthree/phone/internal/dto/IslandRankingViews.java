package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 주간 섬 랭킹의 내부 응답 (GROMO-1997, island-rankings LLD §2).
 *
 * <p>개인정보가 없다 — 섬 이름과 평균 초뿐이다. 그래서 회관 기록 scope=me 와 달리 스냅샷 저장소도, 사용자
 * 역색인도, 탈퇴와의 공통 lifecycle 잠금도 필요 없다(2026-09-19 결정 RC-P12-적용 「복사본이 없으면 필요 없다」).
 */
public final class IslandRankingViews {

    private IslandRankingViews() {
    }

    /**
     * 섬 간 주간 랭킹 한 판.
     *
     * @param week   조회한 주의 시작일({@code YYYY-MM-DD} 인 UTC 일요일) — 요청과 대조해 다른 주를 조용히
     *               받지 않는다
     * @param items  순위 오름차순 상위 목록
     * @param myRank 요청자의 <b>현재 섬</b>이 전체 모집단에서 갖는 순위. 그 섬이 이번 주 랭킹에 참가하지
     *               않으면(집중 0 또는 분모 없음) {@code null} 이다 — 없다는 이유로 0위를 만들지 않는다
     * @param asOf   집계를 고정한 관측 시각
     */
    public record IslandRankingPage(String week, List<IslandRanking> items, Integer myRank, Instant asOf) {
    }

    /**
     * 섬 한 줄.
     *
     * @param averageFocusSeconds 평균 = 그 섬 집중 초 합 ÷ 그 섬 전체 주민 수. <b>표시값이 곧 정렬 키</b>라
     *                            내부 순위와 화면 숫자가 갈리지 않는다(LLD §3)
     */
    public record IslandRanking(int rank, UUID islandId, String name, long averageFocusSeconds) {
    }
}

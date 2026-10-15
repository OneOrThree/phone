package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * 이름 검색 한 페이지 (GROMO-1759, LLD §3.2·§5).
 *
 * <p>커서 경계는 <b>마지막 행의 섬 id 하나</b> 다. 정렬 튜플(trgm 거리)을 토큰에 싣지 않고 다음
 * 페이지에서 그 행을 다시 읽어 거리를 재계산한다 — 같은 레포의 keyset 선례
 * ({@code GroupChallengeBetSessionRepository#findGroupHistoryAfterCursor})가 쓰는 방식이고,
 * 거리 값을 토큰에 넣지 않으니 검색어 원문이 커서로 새지 않는다(LLD §5).
 *
 * <p>여기서 <b>서명하지 않는다</b>. 사용자·필터·limit 에 묶어 서명하는 일은 Business 의
 * {@code SignedCursorCodec} 몫이다. {@code nextIslandId} 가 null 이면 다음 페이지가 없다.
 */
public record IslandSearchPageView(List<IslandSummaryView> items, UUID nextIslandId) {
}

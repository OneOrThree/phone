package com.oneorthree.phone.internal.dto;

import java.util.List;

/**
 * 무작위 발견 한 페이지 (GROMO-1759, LLD §3.3·§5, HLD §4).
 *
 * <p>순서는 <b>seed 로 결정되는 셔플</b> 이다 — 후보마다 {@code md5(seed || islandId)} 를 계산해 그
 * 값으로 정렬하고, 다음 페이지는 마지막 핸들보다 큰 것부터 읽는다. 그래서 «한 탐색 세션의 순서가
 * 고정»되고(PRD M03) 인스턴스가 달라도 같은 순서가 나오며, 매 페이지에서 공개·정원·소속·강퇴
 * 조건을 다시 평가하므로 탈락한 후보는 그냥 빠진다(HLD §4: "후보가 빠지면 남은 고정 순서를 따라
 * 채운다"). 이미 돌려준 후보가 순서를 바꿔 다시 나오는 일은 핸들이 단조 증가하므로 없다.
 *
 * <p>seed 자체는 Business 가 첫 페이지에서 뽑아 서명 커서에 실어 나른다 — 그 서명된 핸들이 곧 LLD
 * §5 가 말하는 "무작위 세션 핸들"이고, TTL 은 커서 서명의 만료창(≤15분)이다. 별도 세션 테이블을
 * 두지 않은 이유는 그 테이블이 주는 «순서 고정·유한 수명» 을 서명 seed 가 그대로 주면서 저장소와
 * 만료 청소를 없애기 때문이다({@code CursorBoundary} 의 javadoc 이 "무작위 탐색 핸들"을 이미
 * 허용한다). 전역 후보 목록을 메모리에 복제하지도 않는다.
 *
 * <p>{@code nextHandle} 이 null 이면 소진이다(공개 계약의 {@code nextCursor:null}).
 */
public record IslandDiscoverPageView(List<IslandSummaryView> items, String nextHandle) {
}

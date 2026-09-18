package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET /internal/users/{userId}/islands} 응답 (GROMO-1759, LLD §3.5).
 *
 * <p>페이지가 없다 — 현재 소속 상한이 10 이라 목록은 전량이다. 공개 계약의 {@code nextCursor} 는
 * 항상 null 이고 그 상수는 Business 가 채운다.
 *
 * <p>{@code currentIslandId} 는 <b>지금도 활성 소속인 섬이거나 null</b> 이다(LLD §3.5). 저장된 컨텍스트가
 * 더 이상 활성 소속이 아니면 그 값을 «그대로 보여주지 않고» null 로 내려보낸다 — 권한 없는 대상을
 * 현재 섬으로 표시하지 않기 위해서다. 저장값 자체를 null 로 «쓰지는» 않는다(IM-D06 미승인).
 */
public record MyIslandsView(List<IslandSummaryView> items, UUID currentIslandId) {
}

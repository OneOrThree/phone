package com.oneorthree.business.api.dto;

import com.oneorthree.business.upstream.data.dto.IslandSummary;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET /me/islands} 공개 응답 (GROMO-1759, LLD §3.5).
 *
 * <p>{@code nextCursor} 는 <b>항상 null</b> 이다 — 소속 상한이 10 이라 목록이 전량이기 때문이다. 키
 * 자체는 남겨 둔다. 상한이 바뀌어 페이지가 생길 때 앱이 읽는 자리를 미리 고정해 두는 편이, 나중에
 * 없던 키를 더하는 것보다 안전하다(LLD §3.5 가 "향후 상한 변경은 페이지 계약을 함께 개정한다"고
 * 한 자리다).
 */
public record MyIslandsResponse(List<IslandSummary> items, String nextCursor, UUID currentIslandId) {
}

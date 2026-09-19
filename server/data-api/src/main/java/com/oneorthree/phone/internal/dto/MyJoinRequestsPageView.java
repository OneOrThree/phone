package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /me/join-requests} 한 페이지 (GROMO-1895, 섬 소속 LLD §3.12) — 본인의 pending 요청만.
 * {@code nextCreatedAt}·{@code nextRequestId} 는 Business 가 서명 커서로 감싸는 평문 경계다.
 */
public record MyJoinRequestsPageView(List<Item> items, Instant nextCreatedAt, UUID nextRequestId) {

    /** 요청 한 건 — {@code id}·{@code status}·{@code version} 은 §3.8 단건 조회와 같은 자원 축이다. */
    public record Item(UUID id, UUID islandId, String islandName, String status, long version,
                       Instant createdAt) {
    }
}

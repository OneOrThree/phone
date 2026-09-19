package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/join-requests} 한 페이지 (GROMO-1802, 섬 관리 LLD §3.3) — 방장 전용,
 * pending 만. {@code nextCreatedAt}·{@code nextRequestId} 는 Business 가 서명 커서로 감싸는 평문 경계다.
 */
public record IslandJoinRequestsPageView(List<Item> items, Instant nextCreatedAt, UUID nextRequestId) {

    /** 신청 한 건 — {@code version} 은 그 요청 자원 축이다(다른 요청과 비교하지 않는다). */
    public record Item(UUID id, UUID applicantId, String name, String status, long version) {
    }
}

package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/join-requests} 한 페이지 (GROMO-1802, 섬 관리 LLD §3.3) — 방장 전용,
 * pending 만. {@code nextCreatedAt}·{@code nextRequestId} 는 Business 가 서명 커서로 감싸는 평문 경계다.
 */
public record IslandJoinRequestsPageView(List<Item> items, Instant nextCreatedAt, UUID nextRequestId) {

    /**
     * 신청 한 건 — {@code version} 은 그 요청 자원 축이다(다른 요청과 비교하지 않는다).
     * {@code catColor} 는 신청자의 {@code users.cat_color}(계정 Q03)이고 미선택이면 null 이다 — 주민 목록과 같다.
     */
    public record Item(UUID id, UUID applicantId, String name, String catColor, String status, long version) {
    }
}

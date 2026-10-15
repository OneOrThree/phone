package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /me/join-requests} 한 페이지 (GROMO-1895, 섬 소속 LLD §3.12) — 본인의 pending 요청만.
 * {@code nextCreatedAt}·{@code nextRequestId} 는 Business 가 서명 커서로 감싸는 평문 경계다.
 */
public record MyJoinRequestsPageView(List<Item> items, Instant nextCreatedAt, UUID nextRequestId) {

    /**
     * 요청 한 건 — {@code id}·{@code status}·{@code version} 은 §3.8 단건 조회와 같은 자원 축이다.
     *
     * <p>{@code memberCount}·{@code maxMembers} 는 GROMO-2047 에서 실었다. 「신청 중」 카드가
     * 「3/15」를 그리려면 둘 다 필요한데, 목록의 각 섬을 다시 조회하면 페이지당 N+1 이 된다.
     * 모수는 방문자 요약({@code IslandSummaryView})과 같다 — 탈퇴·이탈 계정은 세지 않고, 승인
     * 대기 중인 신청도 세지 않는다(정책 「정원에는 방장을 포함한 현재 주민만 센다」).
     */
    public record Item(UUID id, UUID islandId, String islandName, int memberCount, int maxMembers,
                       String status, long version, Instant createdAt) {
    }
}

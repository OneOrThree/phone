package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/members} 한 페이지 (GROMO-1802, 섬 관리 LLD §3.2).
 *
 * <p>{@code nextJoinedAt}·{@code nextMembershipId} 는 다음 페이지의 평문 keyset 경계다 — Business 가 서명
 * 커서로 감싸 앱에 내보내고 앱은 이 값을 직접 보지 못한다. 둘 다 null 이면 마지막 페이지다.
 * {@code version} 은 {@code (ISLAND_MEMBERS, islandId)} 목록 버전이고 행들과 같은 스냅샷에서 읽는다.
 *
 * <p>원본 계약의 {@code catColor} 는 싣지 않는다 — 그 값을 가진 컬럼이 아직 없다(우체통
 * {@code MailboxViewerResponse} 와 같은 판단).
 */
public record IslandMembersPageView(List<Item> items, Instant nextJoinedAt, UUID nextMembershipId, long version) {

    /** 주민 한 명 — {@code id} 는 사용자 ID, {@code role} 은 {@code host}/{@code member}. */
    public record Item(UUID id, String name, String role) {
    }
}

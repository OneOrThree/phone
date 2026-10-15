package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code POST /islands/{islandId}/memberships} 결과 (GROMO-1760, 섬 소속 LLD §3.7).
 *
 * <p>두 결과 형태를 한 record 로 묶는다 — 결정 축은 {@code status} 다:
 * <ul>
 *   <li>{@code "active"} — 즉시 가입. {@code requestId} 는 null 이고 {@code currentIslandId} 는
 *       방금 옮긴 현재 섬이다. {@code version} 은 {@code island.members.updated} 사건의
 *       (ISLAND_MEMBERS) 집계 버전이다.</li>
 *   <li>{@code "pending"} — 승인 대기 요청이 만들어졌거나 이미 있었다. {@code requestId} 가 그
 *       자원이고 {@code version} 은 요청 자원의 버전이다. {@code currentIslandId} 는 null —
 *       대기 생성은 현재 섬을 옮기지 않는다.</li>
 * </ul>
 */
public record JoinIslandResultView(
        String status,
        UUID requestId,
        UUID islandId,
        UUID currentIslandId,
        long version) {

    public static JoinIslandResultView active(UUID islandId, long membersVersion) {
        return new JoinIslandResultView("active", null, islandId, islandId, membersVersion);
    }

    public static JoinIslandResultView pending(UUID requestId, UUID islandId, long requestVersion) {
        return new JoinIslandResultView("pending", requestId, islandId, null, requestVersion);
    }
}

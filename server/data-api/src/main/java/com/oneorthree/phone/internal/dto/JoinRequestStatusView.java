package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code GET /me/join-requests/{requestId}} 응답 (GROMO-1760, 섬 소속 LLD §3.8).
 *
 * <p>공개 필드만 담는 whitelist 다 — {@code terminal_reason} 같은 내부 사유는 나가지 않는다.
 *
 * @param status {@code pending|approved|rejected|cancelled} 중 하나
 * @param version 요청 자원의 버전 — 전이마다 오른다
 */
public record JoinRequestStatusView(
        UUID id,
        UUID islandId,
        String status,
        long version) {
}

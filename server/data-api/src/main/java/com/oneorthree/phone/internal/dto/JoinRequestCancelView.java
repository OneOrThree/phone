package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code DELETE /me/join-requests/{requestId}} 응답 (GROMO-1760, 섬 소속 LLD §3.9).
 * 성공하면 status 는 항상 {@code "cancelled"} 다.
 */
public record JoinRequestCancelView(UUID id, String status) {
}

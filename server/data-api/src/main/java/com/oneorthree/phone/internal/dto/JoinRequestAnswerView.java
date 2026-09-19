package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code PATCH /islands/{islandId}/join-requests/{requestId}} 결과 (GROMO-1802, 섬 관리 LLD §3.4).
 *
 * <p>{@code status} 는 {@code approved}/{@code rejected}. {@code memberId} 는 승인으로 주민이 된 사용자 ID 이고
 * 거절이면 null 이다. {@code version} 은 그 요청 자원의 전이 후 버전이다 — 주민 목록 버전이 아니다.
 */
public record JoinRequestAnswerView(String status, UUID memberId, long version) {
}

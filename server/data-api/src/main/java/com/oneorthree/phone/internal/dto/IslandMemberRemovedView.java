package com.oneorthree.phone.internal.dto;

/** {@code DELETE /islands/{islandId}/members/{userId}} 결과 (GROMO-1802, 섬 관리 LLD §3.6). */
public record IslandMemberRemovedView(boolean removed) {
}

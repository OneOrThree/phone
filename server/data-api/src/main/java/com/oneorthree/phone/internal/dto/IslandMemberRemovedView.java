package com.oneorthree.phone.internal.dto;

/**
 * {@code DELETE /islands/{islandId}/members/{userId}} 결과 (GROMO-1802, 섬 관리 LLD §3.6).
 *
 * @param nextLocation 강퇴된 사람의 다음 위치 (GROMO-2260) — 응답은 방장이 받지만 값은 대상의 것이다
 */
public record IslandMemberRemovedView(boolean removed, NextLocationView nextLocation) {
}

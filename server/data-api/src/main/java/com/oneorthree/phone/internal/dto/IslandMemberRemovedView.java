package com.oneorthree.phone.internal.dto;

/**
 * {@code DELETE /islands/{islandId}/members/{userId}} 결과 (GROMO-1802, 섬 관리 LLD §3.6).
 *
 * <p>강퇴된 사람의 다음 위치는 싣지 않는다 (GROMO-2260) — 이 응답을 받는 사람은 강퇴한 방장이라, 실으면
 * 대상이 속한 다른 섬(비공개 섬 포함)과 먼바다 여부가 방장에게 샌다. 대상의 현재 섬은 서버가 같은 TX 에서
 * 복구하고({@code UserIslandContextRecovery}), 대상 앱은 동기화·강퇴 편지로 안다.
 */
public record IslandMemberRemovedView(boolean removed) {
}

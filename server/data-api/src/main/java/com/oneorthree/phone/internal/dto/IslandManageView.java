package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * {@code PATCH /islands/{islandId}} 결과 (GROMO-1802, 섬 관리 LLD §3.1). {@code version} 은 공개 섬 상태
 * {@code (ISLAND, islandId)} 축이다 — 바뀐 것이 없으면 새 사건 없이 현재 값을 돌려준다.
 *
 * <p>{@code maxMembers} 는 정책 「정원은 마을회관에서 방장이 수정할 수 있다」의 결과값이다(GROMO-1993).
 */
public record IslandManageView(UUID id, String name, String intro, boolean approvalRequired, int maxMembers,
                               long version) {
}

package com.oneorthree.phone.internal.dto;

/**
 * {@code DELETE /islands/{islandId}/memberships/me} 결과 (GROMO-1802, 섬 관리 LLD §3.7). 성공이 원 실행 권한을
 * 없애는 명령이라, 같은 키 재생은 활성 사용자 본인에게 이 최소 증거만 돌려준다(LLD §4).
 */
public record IslandLeftView(boolean left) {
}

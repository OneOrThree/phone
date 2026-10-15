package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 활성 주민에게만 주는 섬 상세 (GROMO-1759, 섬 소속 LLD §2 {@code MemberIslandDetail}).
 *
 * <p>{@link IslandSummaryView} 를 <b>감싸지 않고</b> 필요한 값을 다시 받는다. 방문자 DTO 를 확장해
 * 주민 필드를 덧붙이면 반대로 주민 DTO 에서 방문자 DTO 로 값이 새는 실수가 한 번만 나도 막을 수
 * 없다 — LLD §6 이 "비소속 응답에서 민감 필드의 «키 부재»를 검사한다"고 못 박은 이유다.
 *
 * <p><b>건설·외양 필드는 만들지 않았다.</b> LLD §2 는 여기에 {@code buildings}·{@code assetVersion}·
 * {@code initialConstruction}·{@code constructionTarget}·{@code buildingThemes} 를 요구하지만, 그 정본을
 * 소유하는 건설·외양 도메인이 data-api 에 <b>없다</b>(2026-09-17 실측: 시설·건물·성장 관련 엔티티·
 * 테이블·컬럼 0건). 같은 절이 "건설·테마 재료 계약 확정 전 해당 신규 상세 응답은 완성된 것으로
 * 계산하지 않는다"·"예시 숫자로 대체하지 않는다"고 했으므로 빈 배열이나 가짜 단계를 채워 «구현된
 * 것처럼» 보이게 하지 않는다. island-construction 이 합류할 때 이 record 에 필드를 더한다.
 *
 * @param maxMembers 섬 정원(1~15, GROMO-1993). {@link IslandSummaryView} 에도 같은 값이 있다 — 결정
 *     V-읽기가 정원을 방문자 열람 범위에 넣었다. 고치는 권한만 방장에게 있다
 * @param role {@code host|member} — 저장된 {@code GroupMemberRole} 을 공개 이름으로 옮긴 값이다
 * @param version {@code (island, islandId)} 상태 축의 버전. 외양/주민 목록의 버전과 혼용하지 않는다
 */
public record IslandDetailView(
        UUID id,
        String name,
        String intro,
        String visibility,
        boolean approvalRequired,
        int memberCount,
        int maxMembers,
        String membershipStatus,
        String growthStage,
        String themeId,
        String role,
        long version) {
}

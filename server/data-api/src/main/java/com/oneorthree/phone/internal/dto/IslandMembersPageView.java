package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/members} 한 페이지 (GROMO-1802, 섬 관리 LLD §3.2).
 *
 * <p>{@code nextJoinedAt}·{@code nextMembershipId} 는 다음 페이지의 평문 keyset 경계다 — Business 가 서명
 * 커서로 감싸 앱에 내보내고 앱은 이 값을 직접 보지 못한다. 둘 다 null 이면 마지막 페이지다.
 * {@code version} 은 {@code (ISLAND_MEMBERS, islandId)} 목록 버전이고 행들과 같은 스냅샷에서 읽는다.
 *
 * <p>고양이 외형은 {@code appearance} — 개인 착용 외양(GROMO-1783 {@code personal_appearances}) 스냅샷이다.
 * {@code catColor} 는 {@code users.cat_color}(계정 Q03, GROMO-1945)이고 미선택이면 null 이다. 방문자에게도 같은
 * 모양이고, 집중 기록 등 다른 개인 필드는 없다(GROMO-1937).
 */
public record IslandMembersPageView(List<Item> items, Instant nextJoinedAt, UUID nextMembershipId, long version) {

    /**
     * 주민 한 명 — {@code id} 는 사용자 ID, {@code catColor} 는 고양이 색(미선택 null), {@code role} 은
     * {@code host}/{@code member}, {@code appearance} 는 착용 외양(외양 행이 없으면 기본값·version 0).
     */
    public record Item(UUID id, String name, String catColor, String role, PersonalAppearanceView appearance) {
    }
}

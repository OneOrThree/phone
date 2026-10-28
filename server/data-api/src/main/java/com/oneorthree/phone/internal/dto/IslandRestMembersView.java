package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/rest-members} 의 내부 알맹이 (GROMO-1765, focus-rest-session LLD §2).
 *
 * <p>{@code catColor} 는 {@link IslandFocusMembersView} 와 같은 이유로 싣지 않는다. 원본 RestMember 에 없는
 * {@code sessionId} 도 싣지 않는다(LLD §2 「몰래 추가하지 않는다」) — 휴식 시간 표시는 restStartedAt 과
 * serverNow 로 한다.
 *
 * @param items      paused 인 활성 주민 — restSeat 오름차순
 * @param serverNow  스냅샷 시각
 * @param watermarks 목록의 각 주민에 대한 {@code rest.member} 버전
 */
public record IslandRestMembersView(List<Item> items, Instant serverNow, List<MemberWatermark> watermarks) {

    /**
     * @param userId        주민
     * @param name          표시 이름(닉네임) — 키는 항상 실린다
     * @param restSeat      섬 안 휴식 자리(1..N)
     * @param restStartedAt 이번 휴식의 시작 시각
     */
    public record Item(
            UUID userId,
            @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            int restSeat,
            Instant restStartedAt) {
    }
}

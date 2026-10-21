package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/focus-members} 의 내부 알맹이 (GROMO-1765, focus-rest-session LLD §2).
 *
 * <p>{@code catColor}·{@code appearance} 는 GROMO-2389 로 실린다(주민 목록과 같은 모양). BFF B14 의
 * {@code appearanceVersion} 은 싣지 않는다 — 외양 version 은 {@code appearance.version} 이다.
 *
 * @param items      진행(active/paused) 중인 활성 주민 — completed 는 없다
 * @param serverNow  activeSeconds 를 잰 anchor 이자 스냅샷 시각
 * @param watermarks 목록의 각 주민에 대한 {@code focus.member} 버전
 */
public record IslandFocusMembersView(List<Item> items, Instant serverNow, List<MemberWatermark> watermarks) {

    /**
     * @param userId        주민
     * @param name          표시 이름(닉네임) — 키는 항상 실린다
     * @param sessionId     진행 세션
     * @param subject       집중 주제
     * @param activeSeconds serverNow 기준 순수 ACTIVE 초
     * @param status        {@code "active"} 또는 {@code "paused"}
     * @param catColor      고양이 색 — 미선택·탈퇴면 null
     * @param appearance    착용 외양 — 행이 없는 주민은 기본 외양
     */
    public record Item(
            UUID userId,
            @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            UUID sessionId,
            String subject,
            long activeSeconds,
            String status,
            String catColor,
            PersonalAppearanceView appearance) {
    }
}

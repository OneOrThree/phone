package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/focus-members} 의 내부 알맹이 (GROMO-1765, focus-rest-session LLD §2).
 *
 * <p>원본 계약의 {@code catColor}·{@code appearance} 와 BFF B14 의 {@code appearanceVersion} 은 <b>싣지 않는다</b> —
 * 그 값을 가진 컬럼·도메인이 main 에 없다(catColor 는 계정 Q03 미결, 외양은 GROMO-1783 미병합). {@code null} 로
 * 채우지 않는 것은 우체통({@link MailboxViewerResponse})과 같은 이유다: 다른 계약에서 {@code null} 은
 * 「탈퇴·비노출」이고, B14 의 appearanceVersion 은 필수 정수라 null 이 허용되지 않는다. 제공자가 생기면
 * 필드가 «추가»된다.
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
     */
    public record Item(
            UUID userId,
            @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            UUID sessionId,
            String subject,
            long activeSeconds,
            String status) {
    }
}

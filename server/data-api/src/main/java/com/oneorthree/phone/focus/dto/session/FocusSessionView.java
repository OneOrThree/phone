package com.oneorthree.phone.focus.dto.session;

import java.time.Instant;
import java.util.UUID;

/**
 * 진행 중 v0.3 집중 세션의 공개 표현 (GROMO-1764, LLD §1). start/pause/resume/current가 공유한다.
 *
 * @param id            세션 id(={@code focus_sessions.id}={@code focus_session_details.session_id})
 * @param islandId      소속 섬
 * @param subject       집중 주제
 * @param targetMinutes 목표 시간(분). 선택이라 없을 수 있다(GROMO-1990)
 * @param status        {@code "active"} 또는 {@code "paused"}
 * @param activeSeconds serverNow 시점까지의 순수 집중 초(휴식 제외)
 * @param serverNow     이 응답을 만든 서버 시각 — activeSeconds의 anchor
 * @param startedAt     세션 최초 시작 시각
 * @param restStartedAt paused일 때만 값이 있다. active면 {@code null}
 * @param version       낙관 버전 — 다음 pause/resume/finish의 expectedVersion
 */
public record FocusSessionView(
        UUID id,
        UUID islandId,
        String subject,
        Integer targetMinutes,
        String status,
        long activeSeconds,
        Instant serverNow,
        Instant startedAt,
        Instant restStartedAt,
        long version) {

    public static final String STATUS_ACTIVE = "active";
    public static final String STATUS_PAUSED = "paused";
}

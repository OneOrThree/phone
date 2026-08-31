package com.oneorthree.phone.focus.dto;

import com.oneorthree.phone.focus.repository.domain.FocusType;

import java.time.Instant;
import java.util.UUID;

/**
 * 라이브 집중 세션 시작 요청(GROMO-610).
 *
 * <p>startedAt 만 기록하고 endedAt 은 비운 채(진행 중) 세션을 INSERT 한다.
 * 통계·스트릭은 종료(PATCH) 시점에 귀속되므로 시작 시엔 건드리지 않는다.
 *
 * @param focusTagId 소유 태그 id(user_focus_tags.id, 선택). null 이면 태그 없는 세션
 * @param startedAt  시작 시각(선택). null 이면 서버 수신 시각(Instant.now)
 * @param focusType  세션 유형(INFINITE/RANGE/POMODORO, 선택, GROMO-733). null 이면 INFINITE 기본(하위호환)
 */
public record FocusSessionStartRequest(
        UUID focusTagId,
        Instant startedAt,
        FocusType focusType
) {
    /** 하위호환 — focusType 미지정 기존 호출부(null → 서비스에서 INFINITE 기본). */
    public FocusSessionStartRequest(UUID focusTagId, Instant startedAt) {
        this(focusTagId, startedAt, null);
    }
}

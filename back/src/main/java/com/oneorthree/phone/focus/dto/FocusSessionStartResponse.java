package com.oneorthree.phone.focus.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 라이브 집중 세션 시작 응답(GROMO-610).
 *
 * <p>생성된 세션 id 를 반환해 이후 종료(PATCH /focus-session)에서 sessionId 로 참조하게 한다.
 *
 * @param sessionId 생성된 진행 중 세션 id
 * @param startedAt 확정된 시작 시각
 */
public record FocusSessionStartResponse(
        UUID sessionId,
        Instant startedAt
) {
}

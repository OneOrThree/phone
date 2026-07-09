package com.oneorthree.phone.focus.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 라이브 집중 세션 시작 요청(GROMO-610).
 *
 * <p>startedAt 만 기록하고 endedAt 은 비운 채(진행 중) 세션을 INSERT 한다.
 * 통계·스트릭은 종료(PATCH) 시점에 귀속되므로 시작 시엔 건드리지 않는다.
 *
 * @param focusTagId 소유 태그 id(선택). null 이면 태그 없는 세션
 * @param startedAt  시작 시각(선택). null 이면 서버 수신 시각(Instant.now)
 */
public record FocusSessionStartRequest(
        UUID focusTagId,
        Instant startedAt
) {
}

package com.oneorthree.phone.focus.dto;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.UUID;

/**
 * 라이브 집중 세션 종료 요청(GROMO-610).
 *
 * <p>진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리한다.
 *
 * @param sessionId               종료할 진행 중 세션 id(필수)
 * @param endedAt                 종료 시각(선택). null 이면 서버 수신 시각(Instant.now). startedAt 이후여야 함
 * @param totalDistractionSeconds 세션 중 누적 방해 초(선택, 미지정 시 0)
 * @param focusTagId              시작 시 미지정한 태그 보정용(선택). 소유 태그여야 함
 */
public record FocusSessionEndRequest(
        @NotNull UUID sessionId,
        Instant endedAt,
        int totalDistractionSeconds,
        UUID focusTagId
) {
}

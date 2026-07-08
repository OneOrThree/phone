package com.oneorthree.phone.focus.dto;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 라이브 집중 세션 종료 요청(GROMO-610).
 *
 * <p>진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리한다.
 *
 * @param sessionId               종료할 진행 중 세션 id(필수)
 * @param endedAt                 종료 시각(선택). null 이면 서버 수신 시각(Instant.now). startedAt 이후여야 함
 * @param distractionCount        세션 중 누적 방해 횟수(선택, 미지정 시 0)
 * @param totalDistractionSeconds 세션 중 누적 방해 초(선택, 미지정 시 0)
 * @param focusTagId              시작 시 미지정한 태그 보정용(선택). 소유 태그여야 함
 * @param localDate               클라 로컬 타임존 기준 세션 종료일(GROMO-643). 서버는 UTC 변환 없이 일별 집계 버킷에 사용
 */
public record FocusSessionEndRequest(
        @NotNull UUID sessionId,
        Instant endedAt,
        int distractionCount,
        int totalDistractionSeconds,
        UUID focusTagId,
        @NotNull LocalDate localDate
) {
}

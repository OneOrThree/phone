package com.oneorthree.phone.focus.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * 세션 취소 요청(GROMO-733).
 *
 * <p>진행 중(endedAt NULL) 세션을 취소해 status=CANCELED 로 마감한다. 취소 시각은 서버 수신 시각.
 * 이미 종료/취소된 세션 재취소는 409(SESSION_ALREADY_ENDED) — cancelSessionIfActive 의 endedAt IS NULL 가드로 멱등.
 *
 * @param sessionId 취소할 진행 중 세션 id(필수)
 */
public record FocusSessionCancelRequest(
        @NotNull UUID sessionId
) {
}

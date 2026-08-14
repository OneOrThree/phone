package com.oneorthree.phone.common.exception;

import lombok.Getter;

/**
 * 재시도 가능한 실패의 에러 봉투 — 공용 {@code code}·{@code message} 에 <b>상대 지연</b>을 더한다
 * (GROMO-1577 · policy B17).
 *
 * <p>{@link ErrorResponse} 를 확장하는 이유: 클라가 이미 {@code code} 로 분기하고 있어 봉투 모양을
 * 갈아 끼우면 기존 처리 경로가 통째로 흔들린다. 필드 하나를 더하는 쪽이 additive 다.
 *
 * <p>⚠️ 값은 <b>상대 지연(밀리초)</b>이지 만료 시각이 아니다 — 기기 시계로 해석해야 하는 절대
 * 시각을 실으면 시계가 어긋난 기기가 살아 있는 리스를 즉시 다시 요청하거나(1회 기회 소진),
 * 만료된 뒤에도 한참 기다린다.
 */
@Getter
public class RetryAfterErrorResponse extends ErrorResponse {

    private final long retryAfterMs;

    public RetryAfterErrorResponse(String code, String message, long retryAfterMs) {
        super(code, message);
        this.retryAfterMs = retryAfterMs;
    }
}

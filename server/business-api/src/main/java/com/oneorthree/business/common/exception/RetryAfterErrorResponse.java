package com.oneorthree.business.common.exception;

import lombok.Getter;

/**
 * 재시도 가능한 실패의 봉투 — 공용 {@code code}·{@code message} 에 <b>상대 지연</b>을 더한다.
 *
 * <p>결과 표시 선점 실패({@code RESULT_CLAIM_HELD})가 이 모양으로 나간다. 값은 <b>상대 지연(밀리초)</b>
 * 이지 만료 시각이 아니다 — 절대 시각을 실으면 시계가 어긋난 기기가 살아 있는 리스를 즉시 다시
 * 요청하거나 만료 뒤에도 한참 기다린다. Data API 가 이미 이 모양으로 주므로 <b>중계할 때 값을
 * 다시 계산하지 않는다</b>.
 */
@Getter
public class RetryAfterErrorResponse extends ErrorResponse {

    private final long retryAfterMs;

    public RetryAfterErrorResponse(String code, String message, long retryAfterMs) {
        super(code, message);
        this.retryAfterMs = retryAfterMs;
    }
}

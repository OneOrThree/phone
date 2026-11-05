package com.oneorthree.phone.common.exception;

/**
 * 다시 해도 되는 때까지 <b>남은 시간</b>을 아는 실패 — 봉투에 {@code retryAfterMs}, 헤더에 {@code Retry-After}(초, 올림)를 더한다.
 *
 * <p>상태·{@code code}·문구는 여느 도메인 예외처럼 {@link ErrorCode} 가 정한다. 남은 시간을 실어야 하는 실패만 도메인
 * 예외 대신 이것을 던진다 — 계정당 시간 한도({@link RateLimitedException}) · 바다 한마디 5분 잠금
 * ({@code SEA_REMARK_LOCKED}, GROMO-2759: 응답이 유실된 성공 뒤 재시도한 앱이 잠금을 다시 맞출 길이 이것뿐이다).
 */
public class RetryAfterException extends DomainException {

    private final ErrorCode errorCode;
    private final long retryAfterMs;

    /**
     * @param errorCode    실패 사유
     * @param retryAfterMs 지금부터 다시 해도 되는 때까지 남은 밀리초(서버 시계 기준, 1 이상) — 절대 시각이 아니다
     */
    public RetryAfterException(ErrorCode errorCode, long retryAfterMs) {
        super(errorCode);
        this.errorCode = errorCode;
        this.retryAfterMs = retryAfterMs;
    }

    @Override
    public ErrorCode getErrorCode() {
        return errorCode;
    }

    /** @return 다시 해도 되는 때까지 남은 밀리초 */
    public long getRetryAfterMs() {
        return retryAfterMs;
    }
}

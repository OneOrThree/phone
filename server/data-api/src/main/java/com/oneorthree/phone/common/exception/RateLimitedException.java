package com.oneorthree.phone.common.exception;

/**
 * 계정당 시간 한도 초과 (GROMO-1934) — {@link CommonErrorCode#RATE_LIMITED}(429)에 <b>상대 지연</b>을 싣는다.
 *
 * <p>친구 요청·편지 두 도메인이 같은 코드를 쓰므로 도메인 enum 이 아니라 공통 코드다. Business 는 이
 * 이름을 공개 표의 {@code RATE_LIMITED} 로 그대로 옮기고 {@code retryAfterMs} 로 {@code Retry-After}
 * 헤더를 만든다 — 그래서 이름과 지연 값 둘 다 계약이다.
 */
public class RateLimitedException extends DomainException {

    private final long retryAfterMs;

    /**
     * @param retryAfterMs 현재 윈도가 끝날 때까지 남은 밀리초(서버 시계 기준, 1 이상)
     */
    public RateLimitedException(long retryAfterMs) {
        super(CommonErrorCode.RATE_LIMITED);
        this.retryAfterMs = retryAfterMs;
    }

    @Override
    public CommonErrorCode getErrorCode() {
        return CommonErrorCode.RATE_LIMITED;
    }

    /** @return 다시 시도해도 되는 시점까지 남은 밀리초 */
    public long getRetryAfterMs() {
        return retryAfterMs;
    }
}

package com.oneorthree.business.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * <b>상류가 내린 도메인 판정</b>을 그대로 중계한다 — status · code · message · (있으면) retryAfterMs.
 *
 * <p>왜 다시 매핑하지 않는가: 앱은 이미 {@code GROUP_NOT_FOUND} · {@code NOT_MEMBER} ·
 * {@code SLUG_NOT_FOUND} · {@code RESULT_CLAIM_HELD} · {@code RESULT_CLAIM_STALE} ·
 * {@code RESULT_ALREADY_ACKED} · {@code RESULT_NOT_SETTLED} 같은 문자열로 분기하고 있다(각 도메인
 * {@code XxxErrorCode} 의 상수 이름이 그대로 나가는 계약). Business 를 앞에 세운 것만으로 코드가
 * 바뀌거나 상태가 달라지면 <b>그 분기가 조용히 빠진다</b>. 그래서 Business 는 도메인 실패를
 * 재해석하지 않고 봉투를 통째로 전달한다.
 *
 * <p>{@code retryAfterMs} 가 null 이 아니면 {@link RetryAfterErrorResponse} 로 나간다 — 값도 상류가
 * 계산한 것을 그대로 쓴다. 여기서 다시 계산하면 두 서버의 시계 차이가 그 값에 섞인다.
 */
@Getter
public class UpstreamDomainException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final int status;
    private final String code;
    private final String upstreamMessage;
    private final Long retryAfterMs;

    public UpstreamDomainException(int status, String code, String upstreamMessage, Long retryAfterMs) {
        super(code);
        this.status = status;
        this.code = code;
        this.upstreamMessage = upstreamMessage;
        this.retryAfterMs = retryAfterMs;
    }

    /** 상류 상태가 해석 불가면 502 로 접는다 — 5xx 를 그대로 흘리면 우리 장애와 구분이 안 된다. */
    public HttpStatus resolvedStatus() {
        HttpStatus resolved = HttpStatus.resolve(status);
        if (resolved == null || resolved.is5xxServerError()) {
            return HttpStatus.BAD_GATEWAY;
        }
        return resolved;
    }
}

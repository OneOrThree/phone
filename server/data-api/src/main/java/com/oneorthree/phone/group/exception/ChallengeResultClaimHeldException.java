package com.oneorthree.phone.group.exception;

/**
 * 결과 표시 선점 실패 — 다른 기기의 리스가 아직 살아 있다(GROMO-1577 · policy B17).
 *
 * <p>{@link GroupException} 을 확장해 <b>상대 지연</b>({@code retryAfterMs})을 함께 싣는다.
 * ⚠️ <b>절대 만료 시각을 실어 보내지 않는다</b> — 기기 시계가 서버보다 빠르면 아직 살아 있는
 * lease 를 즉시 다시 요청해 1회 재시도 기회를 소진하고, 느리면 만료 뒤에도 한참 결과를 안 띄운다
 * ({@code ShedLockConfig.usingDbTime()} 주석: "인스턴스 간 시계가 어긋나면 락이 조기 만료되거나
 * 영원히 잡혀 있는 것처럼 보인다"). 값은 <b>서버가 서버 시각으로</b> 계산한다.
 *
 * <p>전용 핸들러가 없어도 {@code GroupException} 핸들러가 같은 상태·코드를 돌려주므로
 * (지연 힌트만 빠진다) 배선이 빠지는 쪽으로 실패한다.
 */
public class ChallengeResultClaimHeldException extends GroupException {

    private final long retryAfterMs;

    public ChallengeResultClaimHeldException(long retryAfterMs) {
        super(GroupErrorCode.RESULT_CLAIM_HELD);
        this.retryAfterMs = retryAfterMs;
    }

    public long getRetryAfterMs() {
        return retryAfterMs;
    }
}

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

    /**
     * 서버 시각으로 계산한 잔여 리스 시간(ms). 절대 만료 시각을 담지 않는 이유는 클래스 주석 참조.
     */
    private final long retryAfterMs;

    /**
     * 선점 실패를 잔여 리스 시간과 함께 던진다. 상태·코드는 {@code RESULT_CLAIM_HELD} 로 고정이라
     * 호출측이 고를 여지가 없다 — 이 예외가 뜻하는 실패는 하나뿐이다.
     *
     * @param retryAfterMs 서버가 서버 시각으로 계산한 잔여 리스 시간(ms) — 클라는 이만큼 기다렸다 재시도한다
     */
    public ChallengeResultClaimHeldException(long retryAfterMs) {
        super(GroupErrorCode.RESULT_CLAIM_HELD);
        this.retryAfterMs = retryAfterMs;
    }

    /**
     * @return 재시도까지 기다릴 밀리초. 전용 핸들러가 없으면 이 힌트만 빠지고 상태·코드는 그대로 나간다.
     */
    public long getRetryAfterMs() {
        return retryAfterMs;
    }
}

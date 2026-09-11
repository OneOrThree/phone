package com.oneorthree.business.common.http;

import java.time.Duration;

/**
 * 한 «요청 전체»에 허용된 시간 예산. 상류 재시도까지 <b>모두 합쳐</b> 이 안에 끝나야 한다.
 *
 * <p>왜 필요한가: 구 앱의 `/l/match` 는 5초에 끊고 실패해도 <b>다음 앱 실행까지 재시도하지 않는다</b>
 * (`deferredInvite.ts:100`). claim 은 전역 15초다(`api.ts:215-218`). 그래서 상류 재시도를 「한 번 더」로
 * 세면 안 된다 — 예산을 넘긴 재시도는 앱이 이미 끊은 뒤에 성공하고, 사용자에게는 되돌릴 수 없는
 * {@code matched:false} 만 남는다. 재시도 여부는 <b>남은 예산</b>으로 판정한다.
 *
 * <p>{@link System#nanoTime()} 기준이다 — 벽시계를 쓰면 NTP 보정이 예산을 늘리거나 줄인다.
 */
public final class Deadline {

    private final long startNanos;
    private final long budgetNanos;

    private Deadline(long startNanos, long budgetNanos) {
        this.startNanos = startNanos;
        this.budgetNanos = budgetNanos;
    }

    /** 지금부터 {@code budget} 동안. */
    public static Deadline startingNow(Duration budget) {
        return new Deadline(System.nanoTime(), budget.toNanos());
    }

    /** 예산이 없는 호출 — 상류의 read timeout 만이 상한이다. */
    public static Deadline unbounded() {
        return new Deadline(System.nanoTime(), Long.MAX_VALUE);
    }

    public boolean isUnbounded() {
        return budgetNanos == Long.MAX_VALUE;
    }

    public Duration remaining() {
        if (isUnbounded()) {
            return Duration.ofNanos(Long.MAX_VALUE);
        }
        long left = budgetNanos - (System.nanoTime() - startNanos);
        return left <= 0 ? Duration.ZERO : Duration.ofNanos(left);
    }

    /**
     * {@code need} 만큼이 남아 있는가 — 재시도를 시작해도 되는지 판정에 쓴다.
     *
     * <p>여유가 없으면 <b>시도하지 않는다</b>. 시작해 놓고 중간에 끊으면 상류에는 쓰기가 반쯤 적용된
     * 채로 남고 우리 쪽에는 결과가 없다.
     */
    public boolean hasRoomFor(Duration need) {
        if (isUnbounded()) {
            return true;
        }
        return remaining().compareTo(need) >= 0;
    }
}

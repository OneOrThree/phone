package com.oneorthree.business.common.http;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 상류별 서킷. <b>연속 실패</b>가 임계치를 넘으면 일정 시간 요청을 차단하고, 그 뒤 한 건만 통과시켜
 * 회복을 확인한다(half-open).
 *
 * <p>왜 직접 만드는가: 필요한 것은 「죽은 상류에 계속 두들기지 않는다」 하나다. 이 서비스는 무상태라
 * 서킷 상태를 공유할 곳이 없고(인스턴스별로 독립이어도 목적은 달성된다), 라이브러리를 들이면 설정
 * 표면이 커지는 대신 <b>차단 판정이 어디서 나는지</b>가 흐려진다.
 *
 * <p><b>차단은 「응답 없음」이지 「아니오」가 아니다</b> — 호출부는 이 상태를
 * {@code UpstreamUnavailableException} 으로 올려 503 을 준다. 정상 응답으로 접으면 되돌릴 수 없는
 * {@code matched:false} 나 토큰 영구 유실이 된다.
 *
 * <p>실패 카운터는 <b>성공 한 번에 0 으로 돌아간다</b> — 누적 실패로 세면 오래 산 인스턴스가 정상
 * 상태에서도 결국 열린다.
 */
public class CircuitBreaker {

    private final int failureThreshold;
    private final long openMillis;

    private final AtomicInteger consecutiveFailures = new AtomicInteger();
    /** 서킷이 열린 시각(epoch ms). 0 이면 닫힌 상태다. */
    private final AtomicLong openedAt = new AtomicLong();
    /** half-open 에서 탐침 한 건을 이미 내보냈는가. */
    private final AtomicLong probeInFlightSince = new AtomicLong();

    public CircuitBreaker(int failureThreshold, Duration openDuration) {
        if (failureThreshold <= 0) {
            throw new IllegalArgumentException("failureThreshold 는 1 이상이어야 한다");
        }
        this.failureThreshold = failureThreshold;
        this.openMillis = openDuration.toMillis();
    }

    /**
     * 지금 호출을 내보내도 되는가.
     *
     * @param nowMillis 현재 시각 — 테스트가 시간을 밀 수 있도록 주입받는다
     */
    public boolean allowRequest(long nowMillis) {
        long opened = openedAt.get();
        if (opened == 0L) {
            return true;
        }
        if (nowMillis - opened < openMillis) {
            return false;
        }
        // 차단 시간이 지났다 — 탐침 «한 건»만 통과시킨다. 전원을 한꺼번에 풀면 죽은 상류가 다시 밟힌다.
        return probeInFlightSince.compareAndSet(0L, nowMillis);
    }

    /** 성공 — 연속 실패를 0 으로 되돌리고 서킷을 닫는다. */
    public void recordSuccess() {
        consecutiveFailures.set(0);
        openedAt.set(0L);
        probeInFlightSince.set(0L);
    }

    /** 실패 — 임계치에 닿으면 그 시점부터 차단한다. half-open 탐침이 실패하면 창이 다시 시작된다. */
    public void recordFailure(long nowMillis) {
        probeInFlightSince.set(0L);
        if (consecutiveFailures.incrementAndGet() >= failureThreshold) {
            openedAt.set(nowMillis);
        }
    }

    /** 관측·테스트용. */
    public boolean isOpen(long nowMillis) {
        long opened = openedAt.get();
        return opened != 0L && nowMillis - opened < openMillis;
    }
}

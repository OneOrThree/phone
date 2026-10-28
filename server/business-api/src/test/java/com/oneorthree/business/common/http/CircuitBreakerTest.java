package com.oneorthree.business.common.http;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/** 서킷의 상태 전이 — 시간을 주입해 결정적으로 본다. */
@DisplayName("서킷 브레이커")
class CircuitBreakerTest {

    @Test
    @DisplayName("연속 실패가 임계치에 닿으면 차단한다")
    void 임계치에서차단() {
        CircuitBreaker breaker = new CircuitBreaker(3, Duration.ofSeconds(10));
        long now = 1_000L;

        breaker.recordFailure(now);
        breaker.recordFailure(now);
        assertThat(breaker.allowRequest(now)).isTrue();

        breaker.recordFailure(now);
        assertThat(breaker.allowRequest(now)).isFalse();
    }

    @Test
    @DisplayName("성공 한 번이 카운터를 0 으로 되돌린다 — 누적으로 세면 오래 산 인스턴스가 정상에서도 열린다")
    void 성공이카운터초기화() {
        CircuitBreaker breaker = new CircuitBreaker(2, Duration.ofSeconds(10));
        long now = 1_000L;

        breaker.recordFailure(now);
        breaker.recordSuccess();
        breaker.recordFailure(now);

        assertThat(breaker.allowRequest(now)).isTrue();
    }

    @Test
    @DisplayName("차단 시간이 지나면 탐침 «한 건»만 통과한다 — 전원을 한꺼번에 풀면 죽은 상류가 다시 밟힌다")
    void halfOpen탐침() {
        CircuitBreaker breaker = new CircuitBreaker(1, Duration.ofSeconds(10));
        breaker.recordFailure(1_000L);
        assertThat(breaker.allowRequest(1_000L)).isFalse();

        long afterWindow = 1_000L + 10_001L;
        assertThat(breaker.allowRequest(afterWindow)).isTrue();
        // 두 번째는 막힌다 — 탐침은 하나다.
        assertThat(breaker.allowRequest(afterWindow)).isFalse();
    }

    @Test
    @DisplayName("탐침이 실패하면 차단 창이 다시 시작된다")
    void 탐침실패면재차단() {
        CircuitBreaker breaker = new CircuitBreaker(1, Duration.ofSeconds(10));
        breaker.recordFailure(1_000L);

        long afterWindow = 11_002L;
        assertThat(breaker.allowRequest(afterWindow)).isTrue();
        breaker.recordFailure(afterWindow);

        assertThat(breaker.isOpen(afterWindow + 1)).isTrue();
    }

    @Test
    @DisplayName("탐침이 성공하면 닫힌다")
    void 탐침성공이면복구() {
        CircuitBreaker breaker = new CircuitBreaker(1, Duration.ofSeconds(10));
        breaker.recordFailure(1_000L);

        long afterWindow = 11_002L;
        assertThat(breaker.allowRequest(afterWindow)).isTrue();
        breaker.recordSuccess();

        assertThat(breaker.isOpen(afterWindow)).isFalse();
        assertThat(breaker.allowRequest(afterWindow)).isTrue();
    }
}

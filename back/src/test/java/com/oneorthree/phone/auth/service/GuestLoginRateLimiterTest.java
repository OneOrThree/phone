package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GuestLoginRateLimiterTest {

    private static final Instant T0 = Instant.parse("2026-08-11T00:00:00Z");

    /** 테스트에서 앞으로 감을 수 있는 시계. */
    private static final class MovableClock extends Clock {
        private Instant now = T0;

        void advance(Duration amount) {
            now = now.plus(amount);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }

    private final MovableClock clock = new MovableClock();
    private final GuestLoginRateLimiter limiter =
            new GuestLoginRateLimiter(3, Duration.ofHours(1), clock);

    @Test
    @DisplayName("한도까지는 통과하고 한도 초과분부터 429 로 끊는다")
    void blocksOverLimit() {
        for (int i = 0; i < 3; i++) {
            assertThatCode(() -> limiter.check("1.1.1.1")).doesNotThrowAnyException();
        }

        assertThatThrownBy(() -> limiter.check("1.1.1.1"))
                .isInstanceOf(AuthException.class)
                .extracting(e -> ((AuthException) e).getErrorCode())
                .isEqualTo(AuthErrorCode.GUEST_CREATION_RATE_LIMITED);
    }

    @Test
    @DisplayName("한도는 IP 별로 따로 센다 — 옆 IP 가 소진해도 막히지 않는다")
    void countsPerIp() {
        for (int i = 0; i < 4; i++) {
            try {
                limiter.check("1.1.1.1");
            } catch (AuthException ignored) {
                // 소진시키는 게 목적
            }
        }

        assertThatCode(() -> limiter.check("2.2.2.2")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("윈도가 지나면 카운터가 리셋된다")
    void resetsAfterWindow() {
        for (int i = 0; i < 3; i++) {
            limiter.check("1.1.1.1");
        }
        assertThatThrownBy(() -> limiter.check("1.1.1.1")).isInstanceOf(AuthException.class);

        clock.advance(Duration.ofHours(1));

        assertThatCode(() -> limiter.check("1.1.1.1")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("차단 중에도 윈도 시작 시각은 밀리지 않는다 — 계속 두드려도 윈도 끝에 풀린다")
    void blockedRequestsDoNotExtendWindow() {
        for (int i = 0; i < 3; i++) {
            limiter.check("1.1.1.1");
        }

        // 윈도 절반 지점에서 계속 두드려도 윈도는 T0 기준 그대로여야 한다
        clock.advance(Duration.ofMinutes(30));
        assertThatThrownBy(() -> limiter.check("1.1.1.1")).isInstanceOf(AuthException.class);

        clock.advance(Duration.ofMinutes(30));
        assertThatCode(() -> limiter.check("1.1.1.1")).doesNotThrowAnyException();
        assertThat(clock.instant()).isEqualTo(T0.plus(Duration.ofHours(1)));
    }
}

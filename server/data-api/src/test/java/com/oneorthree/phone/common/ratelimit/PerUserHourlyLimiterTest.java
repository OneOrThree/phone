package com.oneorthree.phone.common.ratelimit;

import com.oneorthree.phone.common.exception.RateLimitedException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 계정당 1시간 고정 윈도 (GROMO-1934). 잡는 회귀: 한도 경계 off-by-one(cap 번째를 막거나 cap+1 을 통과),
 * retryAfterMs 를 윈도 시작 기준이 아닌 값(0·전체 윈도·절대 시각)으로 계산, 윈도가 지나도 풀리지 않음,
 * 차단 중 두드림이 윈도를 연장, 계정 사이 카운터 공유.
 */
class PerUserHourlyLimiterTest {

    private static final Instant T0 = Instant.parse("2026-09-19T00:00:00Z");
    private static final int CAP = 3;

    /** 앞으로 감을 수 있는 시계. */
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
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }

    private final MovableClock clock = new MovableClock();
    private final PerUserHourlyLimiter limiter = new PerUserHourlyLimiter("test.limit", CAP, clock);
    private final UUID user = UUID.randomUUID();

    @Test
    @DisplayName("정확히 한도까지는 통과하고 한도+1 번째는 윈도 잔여 시간을 실어 막는다")
    void capReachedPassesAndCapPlusOneIsRejectedWithRemainingWindow() {
        for (int i = 0; i < CAP; i++) {
            clock.advance(Duration.ofMinutes(10));
            assertThatCode(() -> limiter.acquire(user)).doesNotThrowAnyException();
        }
        // 윈도는 첫 요청(T0+10분)에 시작했고 지금은 T0+30분 → 40분 남았다.
        assertThatThrownBy(() -> limiter.acquire(user))
                .isInstanceOfSatisfying(RateLimitedException.class, e ->
                        assertThat(e.getRetryAfterMs()).isEqualTo(Duration.ofMinutes(40).toMillis()));
    }

    @Test
    @DisplayName("윈도 끝 직전까지 막히고, 첫 요청 + 1시간 정각에 새 윈도가 열린다 — 차단 중 두드림은 윈도를 밀지 않는다")
    void windowRollsOverExactlyOneHourAfterFirstRequest() {
        for (int i = 0; i < CAP; i++) {
            limiter.acquire(user);
        }
        clock.advance(Duration.ofMinutes(59));
        assertThatThrownBy(() -> limiter.acquire(user)).isInstanceOf(RateLimitedException.class);
        clock.advance(Duration.ofSeconds(59).plusMillis(999));
        assertThatThrownBy(() -> limiter.acquire(user))
                .isInstanceOfSatisfying(RateLimitedException.class, e -> assertThat(e.getRetryAfterMs()).isEqualTo(1));

        clock.advance(Duration.ofMillis(1));   // T0 + 1h 정각
        for (int i = 0; i < CAP; i++) {
            assertThatCode(() -> limiter.acquire(user)).as("새 윈도 %d번째", i + 1).doesNotThrowAnyException();
        }
        assertThatThrownBy(() -> limiter.acquire(user)).isInstanceOf(RateLimitedException.class);
    }

    @Test
    @DisplayName("계정마다 따로 센다 — 한 계정이 막혀도 다른 계정은 한도를 온전히 받는다")
    void countsPerAccount() {
        for (int i = 0; i < CAP; i++) {
            limiter.acquire(user);
        }
        assertThatThrownBy(() -> limiter.acquire(user)).isInstanceOf(RateLimitedException.class);

        UUID other = UUID.randomUUID();
        for (int i = 0; i < CAP; i++) {
            assertThatCode(() -> limiter.acquire(other)).doesNotThrowAnyException();
        }
    }

    @Test
    @DisplayName("0 이하·Integer.MAX_VALUE 한도는 부팅에서 거부한다 — 보호가 조용히 꺼지거나 전부 막힌다")
    void rejectsBrokenConfigAtBoot() {
        assertThatThrownBy(() -> new PerUserHourlyLimiter("x", 0, clock)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PerUserHourlyLimiter("x", Integer.MAX_VALUE, clock))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

package com.oneorthree.phone.auth.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

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
    // IP 한도 검증이 목적인 테스트들이라 전역 상한은 닿지 않을 만큼 크게 둔다(전역은 아래 전용 테스트).
    private final GuestLoginRateLimiter limiter =
            new GuestLoginRateLimiter(3, 1_000_000, Duration.ofHours(1), clock);

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
    @DisplayName("IPv6 는 /64 프리픽스로 센다 — 같은 프리픽스에서 주소만 바꿔도 한도를 새로 못 받는다")
    void countsIpv6ByPrefix() {
        limiter.check("2001:db8:0:1::1");
        limiter.check("2001:db8:0:1::2");
        limiter.check("2001:db8:0:1:aaaa:bbbb:cccc:dddd");

        assertThatThrownBy(() -> limiter.check("2001:db8:0:1::9"))
                .isInstanceOf(AuthException.class);
        // 다른 /64 는 별개 버킷
        assertThatCode(() -> limiter.check("2001:db8:0:2::1")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("차단 로그는 윈도당 한 번만 — 계속 두드려도 로그가 요청 수만큼 늘지 않는다")
    void logsBlockOncePerWindow() {
        Logger logger = (Logger) LoggerFactory.getLogger(GuestLoginRateLimiter.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            for (int i = 0; i < 3; i++) {
                limiter.check("1.1.1.1");
            }
            for (int i = 0; i < 5; i++) {
                assertThatThrownBy(() -> limiter.check("1.1.1.1")).isInstanceOf(AuthException.class);
            }

            assertThat(appender.list).hasSize(1);

            // 윈도가 바뀌면 다시 한 번은 남는다
            clock.advance(Duration.ofHours(1));
            for (int i = 0; i < 4; i++) {
                try {
                    limiter.check("1.1.1.1");
                } catch (AuthException ignored) {
                    // 새 윈도를 소진시키는 게 목적
                }
            }
            assertThat(appender.list).hasSize(2);
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    @DisplayName("전역 상한은 키를 바꿔도 우회되지 않는다 — 키 위조로 IP 한도를 피해도 총량은 묶인다")
    void globalCapSurvivesKeyRotation() {
        GuestLoginRateLimiter limited = new GuestLoginRateLimiter(3, 5, Duration.ofHours(1), clock);

        // 매번 다른 IP = IP 한도는 전부 통과하지만 전역 5회에서 걸린다.
        for (int i = 0; i < 5; i++) {
            int n = i;
            assertThatCode(() -> limited.check("203.0.113." + n)).doesNotThrowAnyException();
        }

        assertThatThrownBy(() -> limited.check("203.0.113.99"))
                .isInstanceOf(AuthException.class)
                .extracting(e -> ((AuthException) e).getErrorCode())
                .isEqualTo(AuthErrorCode.GUEST_CREATION_RATE_LIMITED);

        // 윈도가 지나면 전역도 풀린다
        clock.advance(Duration.ofHours(1));
        assertThatCode(() -> limited.check("203.0.113.99")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("IP 한도에서 막힌 요청은 전역 예산을 태우지 않는다 — 한 IP 를 두들겨 정상 가입을 막을 수 없다")
    void blockedByIpLimitDoesNotConsumeGlobalBudget() {
        GuestLoginRateLimiter limited = new GuestLoginRateLimiter(3, 5, Duration.ofHours(1), clock);

        // 한 IP 로 3회 통과 + 50회 차단 — 전역 카운터는 3 에서 멈춰 있어야 한다.
        for (int i = 0; i < 53; i++) {
            try {
                limited.check("1.1.1.1");
            } catch (AuthException ignored) {
                // 두들기는 게 목적
            }
        }

        // 전역 예산이 5 - 3 = 2 회 남아 있어야 정상 유저가 들어온다.
        assertThatCode(() -> limited.check("2.2.2.2")).doesNotThrowAnyException();
        assertThatCode(() -> limited.check("3.3.3.3")).doesNotThrowAnyException();
        assertThatThrownBy(() -> limited.check("4.4.4.4")).isInstanceOf(AuthException.class);
    }

    @Test
    @DisplayName("잘못된 설정은 기동 단계에서 죽인다 — 조용히 보호가 꺼지거나 전부 막히는 걸 막는다")
    void rejectsInvalidConfig() {
        assertThatThrownBy(() -> new GuestLoginRateLimiter(0, 300, Duration.ofHours(1), clock))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GuestLoginRateLimiter(10, 0, Duration.ofHours(1), clock))
                .isInstanceOf(IllegalArgumentException.class);
        // 한도+1 이 넘쳐 제한이 조용히 꺼지는 값도 막는다
        assertThatThrownBy(() -> new GuestLoginRateLimiter(Integer.MAX_VALUE, 300, Duration.ofHours(1), clock))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GuestLoginRateLimiter(10, Integer.MAX_VALUE, Duration.ofHours(1), clock))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GuestLoginRateLimiter(10, 300, Duration.ZERO, clock))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GuestLoginRateLimiter(10, 300, Duration.ofMinutes(-1), clock))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("키가 상한을 넘겨 쏟아져도 맵은 상한에서 멈춘다 — 오래된 IP 가 밀려나며 카운터가 초기화된다")
    void evictsOldestBeyondCap() {
        limiter.check("1.1.1.1");
        limiter.check("1.1.1.1");
        limiter.check("1.1.1.1");
        assertThatThrownBy(() -> limiter.check("1.1.1.1")).isInstanceOf(AuthException.class);

        // 만료되지 않은 고유 키로 상한(10_000)을 넘겨 채운다 — 종전 구현은 여기서 맵이 무한히 커졌다.
        for (int i = 0; i < 10_001; i++) {
            limiter.check("10.%d.%d.%d".formatted(i / 65536, (i / 256) % 256, i % 256));
        }

        // 1.1.1.1 은 LRU 로 밀려나 새 윈도를 받는다 = 맵이 상한에서 잘렸다는 증거.
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

package com.oneorthree.business.auth;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/** 조회 실패 뒤 차단 시간 동안은 Redis 를 부르지 않는다 — 장애 중 요청마다 타임아웃을 물지 않게. */
class RevokedSessionsBreakerTest {

    @Test
    void failureSkipsRedisUntilBreakerCloses() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-10-07T00:00:00Z"));
        Clock clock = new Clock() {
            @Override public ZoneOffset getZone() {
                return ZoneOffset.UTC;
            }

            @Override public Clock withZone(java.time.ZoneId zone) {
                return this;
            }

            @Override public Instant instant() {
                return now.get();
            }
        };
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        given(redis.hasKey(anyString())).willThrow(new RedisConnectionFailureException("down"));
        RevokedSessions revoked = new RevokedSessions(redis, Duration.ofSeconds(5), clock);

        assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();   // 실패 → 차단 열림
        assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();   // 차단 중 — Redis 안 부름
        verify(redis, times(1)).hasKey(anyString());

        now.set(now.get().plus(RevokedSessions.BREAKER_OPEN));         // 차단 시간이 지나면 다시 시도
        assertThat(revoked.isRevoked(UUID.randomUUID())).isFalse();
        verify(redis, times(2)).hasKey(anyString());
    }
}

package com.oneorthree.phone.config;

import com.oneorthree.phone.common.ratelimit.PerUserHourlyLimiter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * 계정당 시간 한도 (GROMO-1934) — 엔드포인트마다 카운터 하나라 친구 요청과 편지는 따로 센다.
 * 기본값은 {@code @Value} 에 있다(베이스 {@code application.yml} 이 레포에 없다 — {@code GuestLoginRateLimiter}
 * 선례). 배포 yml 은 필요할 때만 덮는다({@code application-loadtest.yml}).
 */
@Configuration
public class RateLimitConfig {

    /** 게스트 친구 요청 — 정회원은 세지 않는다(오너 확정). */
    @Bean
    public PerUserHourlyLimiter friendRequestRateLimiter(
            @Value("${friend.request.rate-limit.guest-max-per-hour:20}") int maxPerHour, Clock clock) {
        return new PerUserHourlyLimiter("friend.request.rate-limit.guest-max-per-hour", maxPerHour, clock);
    }

    /** 편지 발송 — 전 계정(편지 도메인엔 게스트 분기가 없다, FL-결정-1). */
    @Bean
    public PerUserHourlyLimiter letterSendRateLimiter(
            @Value("${letter.send.rate-limit.max-per-hour:50}") int maxPerHour, Clock clock) {
        return new PerUserHourlyLimiter("letter.send.rate-limit.max-per-hour", maxPerHour, clock);
    }
}

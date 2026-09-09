package com.oneorthree.phone.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * 서버 시계 빈 (GROMO-1723).
 *
 * <p>«지금»에 기대는 판정(클라 시각 클램프 창·귀속 날짜·지급 창)을 가진 서비스는 {@code Instant.now()} 를
 * 직접 읽지 않고 이 빈을 주입받는다. 운영에선 시스템 시계 하나뿐이고, 단위 테스트는 고정 시계를 넣어
 * 실행 시각과 무관하게 같은 결과를 낸다 — {@code FocusServiceTest} 가 KST 00~01시마다 자정 걸침으로
 * 실패하던 것이 계기다. UTC 인 이유: 서비스는 {@code Instant} 만 쓰고 날짜 버킷은
 * {@code ZonePolicy.KST} 로 명시 변환하므로 시계의 존은 의미가 없다.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}

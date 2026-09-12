package com.oneorthree.realtime.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * 시계를 빈으로 둔다 — 서비스가 {@code Instant.now()} 를 직접 부르지 않게 하기 위해서다.
 *
 * <p>직접 부르면 그 코드는 벽시계에 묶여, 시각이 얽힌 동작(정렬 경계·커서·자정 근처)을 테스트에서
 * 재현할 방법이 사라진다. Data API 가 같은 이유로 {@code FocusService} 에 시계를 주입했다(GROMO-1723).
 *
 * <p>UTC 로 고정한다. 저장은 전부 {@code Instant} 라 표시 시간대는 앱이 정하고, 서버가 지역 시간대를
 * 들고 있으면 배포 지역이 바뀔 때 값이 조용히 달라진다.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}

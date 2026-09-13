package com.oneorthree.business.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * {@code business.upstream.*} 바인딩.
 *
 * <p>토큰·주소에 <b>기본값을 주지 않는다</b>. yml 에 {@code ${SVC_TOKEN_BIZ_TO_DATA}} 같은 플레이스홀더만
 * 두고 값은 환경에서 온다 — 기본값을 두면 시크릿이 안 꽂힌 채 부팅되고, 그 상태는 상류의 401 로만
 * 드러나서 「인증 장애」로 오진된다. 실제 fail-fast 는 {@code InternalHttpClient} 생성자가 한다.
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "business.upstream")
public class UpstreamConfigProperties {

    private Target data = new Target();
    private Target notification = new Target();
    private Target link = new Target();
    private Composition composition = new Composition();

    /** 대상 셋과 조합 worker의 합계. Tomcat·JVM·Redis·미리보기/PDF PID 여유는 별도로 남긴다. */
    public void validateWorkerBudget() {
        if (data.getMaxConnections() < 1 || notification.getMaxConnections() < 1
                || link.getMaxConnections() < 1 || composition.getPoolSize() < 1) {
            throw new IllegalArgumentException("상류 HTTP 및 화면 조합 worker는 각각 1 이상이어야 합니다.");
        }
        long total = (long) data.getMaxConnections() + notification.getMaxConnections()
                + link.getMaxConnections() + composition.getPoolSize();
        if (total > 16) {
            throw new IllegalArgumentException("상류 HTTP 및 화면 조합 worker 합계는 16 이하여야 합니다.");
        }
    }

    /** 초기 JVM 안전 상한이며 운영 처리량/SLO를 보장하는 수치가 아니다. */
    @Getter
    @Setter
    public static class Composition {
        private int poolSize = 4;
        private int queueCapacity = 64;
        private Duration deadline = Duration.ofSeconds(3);
    }

    /** 상류 하나의 설정. */
    @Getter
    @Setter
    public static class Target {

        private String baseUrl;
        private String serviceToken;
        /** 연결 수립 제한. 무제한은 허용하지 않는다. */
        private Duration connectTimeout = Duration.ofMillis(500);
        /** 응답 대기 제한. 구 앱 match 5초 예산 안에서 «재시도 2회»가 들어가도록 잡는다. */
        private Duration readTimeout = Duration.ofMillis(1500);
        /** 연속 실패 몇 번에 서킷을 여는가. */
        private int failureThreshold = 5;
        private int maxAttempts = 2;
        private Duration retryDelay = Duration.ofMillis(50);
        private int maxConnections = 4;
        private int queueCapacity = 64;
        /** 서킷 차단 시간. */
        private Duration openDuration = Duration.ofSeconds(10);
    }
}

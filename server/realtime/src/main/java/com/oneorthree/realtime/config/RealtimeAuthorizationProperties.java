package com.oneorthree.realtime.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

/**
 * 신규 모드는 기본 OFF. 잘못된 설정값을 로그에 포함하지 않는다.
 *
 * <p>prefix는 Data 제공자 스위치 env({@code REALTIME_MEMBERSHIP_AUTHORIZATION_ENABLED})의 완화 바인딩 형태와
 * 겹치지 않아야 한다. 옛 {@code realtime.membership-authorization.enabled}는 그 env를 직접 읽어 yml 자리표시자를
 * 무시했다({@code RealtimeAuthorizationConfigTest}가 회귀를 잡는다).
 */
@Getter
@Setter
@ConfigurationProperties(prefix = RealtimeAuthorizationProperties.PREFIX)
public class RealtimeAuthorizationProperties implements InitializingBean {
    public static final String PREFIX = "realtime.authorization-client";

    private boolean enabled;
    private String baseUrl = "";
    private String serviceToken = "";
    private Duration connectTimeout = Duration.ofMillis(500);
    private Duration requestTimeout = Duration.ofMillis(1500);
    private int maxInFlight = 16;

    @Override
    public void afterPropertiesSet() {
        validate();
    }

    public void validate() {
        requireDuration(connectTimeout);
        requireDuration(requestTimeout);
        if (maxInFlight < 1 || maxInFlight > 64) {
            throw new IllegalArgumentException("현재 멤버십 동시 호출 한도는 1~64입니다.");
        }
        if (!enabled) {
            return;
        }
        try {
            URI uri = URI.create(baseUrl);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                    || uri.getFragment() != null || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))
                    || (uri.getPort() != -1 && (uri.getPort() < 1 || uri.getPort() > 65535))) {
                throw new IllegalArgumentException();
            }
            if (serviceToken == null || serviceToken.isBlank() || serviceToken.length() > 8192
                    || serviceToken.chars().anyMatch(value -> value <= 32 || value >= 127)) {
                throw new IllegalArgumentException();
            }
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("현재 멤버십 Data URL 또는 서비스 자격 설정이 올바르지 않습니다.");
        }
    }

    private static void requireDuration(Duration value) {
        if (value == null || value.compareTo(Duration.ofMillis(1)) < 0
                || value.compareTo(Duration.ofSeconds(10)) > 0) {
            throw new IllegalArgumentException("현재 멤버십 호출 제한은 1ms~10s입니다.");
        }
    }
}

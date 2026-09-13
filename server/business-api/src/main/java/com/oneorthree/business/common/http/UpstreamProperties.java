package com.oneorthree.business.common.http;

import java.time.Duration;

/** 상류별 시간·시도·연결·대기 상한. 무제한 값은 시작할 때 거부한다. */
public record UpstreamProperties(String baseUrl, String serviceToken, Duration connectTimeout,
        Duration readTimeout, int failureThreshold, Duration openDuration, int maxAttempts,
        Duration retryDelay, int maxConnections, int queueCapacity) {

    /** 기존 facade/테스트 생성자의 호환 기본값. */
    public UpstreamProperties(String baseUrl, String serviceToken, Duration connectTimeout,
            Duration readTimeout, int failureThreshold, Duration openDuration) {
        this(baseUrl, serviceToken, connectTimeout, readTimeout, failureThreshold, openDuration,
                2, Duration.ofMillis(50), 4, 64);
    }

    public UpstreamProperties {
        if (connectTimeout == null || connectTimeout.isNegative() || connectTimeout.isZero()
                || readTimeout == null || readTimeout.isNegative() || readTimeout.isZero()
                || openDuration == null || openDuration.isNegative() || openDuration.isZero()
                || retryDelay == null || retryDelay.isNegative()
                || maxAttempts < 1 || maxAttempts > 10 || failureThreshold < 1
                || maxConnections < 1 || queueCapacity < 1) {
            throw new IllegalArgumentException("상류 시간·횟수·용량 설정이 올바르지 않습니다.");
        }
    }
}

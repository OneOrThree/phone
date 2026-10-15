package com.oneorthree.phone.common.analytics;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * GA4 전송을 하지 않는 기본 구현 — dev/local/ci 의 기본값이다.
 *
 * <p>GA4 자격증명(api_secret 등)은 prod 에만 있고, 없는 환경에서 전송을 시도하면 매 요청 실패 로그만
 * 쌓인다. 더 나쁜 건 dev 트래픽이 prod 프로퍼티에 섞여 퍼널 수치를 오염시키는 경우다 —
 * 그래서 "설정이 없으면 끈다" 를 기본값으로 둔다.
 *
 * <p>실구현은 WS-2 의 {@code Ga4MeasurementClientImpl}({@code ga4.enabled=true} 일 때 활성)이 맡는다.
 */
@Component
@ConditionalOnProperty(name = "ga4.enabled", havingValue = "false", matchIfMissing = true)
@Slf4j
public class NoopGa4MeasurementClient implements Ga4MeasurementClient {

    @Override
    public void sendAppEvent(String appInstanceId, String name, Map<String, Object> params) {
        log.debug("[GA4:noop] app event 무시 name={} params={}", name, params);
    }

    @Override
    public void sendWebEvent(String syntheticClientId, String name, Map<String, Object> params) {
        log.debug("[GA4:noop] web event 무시 name={} params={}", name, params);
    }
}

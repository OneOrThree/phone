package com.oneorthree.phone.common.analytics;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriBuilder;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * GA4 Measurement Protocol 실전송 클라이언트 (스펙 §6-2) — {@code ga4.enabled=true}(prod) 에서만 활성.
 * 미설정 시에는 상보 조건의 no-op 구현이 대신 뜬다.
 *
 * <p>전송: POST https://www.google-analytics.com/mp/collect
 * <ul>
 *   <li>앱스트림 — {@code ?firebase_app_id=..&api_secret=..} + 본문 {@code app_instance_id}</li>
 *   <li>웹스트림 — {@code ?measurement_id=..&api_secret=..} + 본문 {@code client_id}</li>
 * </ul>
 *
 * <p>분석 이벤트는 유실돼도 서비스 흐름에 영향이 없다. {@code @Async("ga4Executor")} 로 호출 스레드에서
 * 떼어내고, 전송 실패는 예외를 삼키고 WARN 로그만 남긴다(선례: {@code FcmPushNotificationClient}).
 * GA4 는 잘못된 페이로드에도 2xx 를 반환하므로 상태 코드로 성공을 단정하지 않는다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "ga4.enabled", havingValue = "true")
public class Ga4MeasurementClientImpl implements Ga4MeasurementClient {

    private static final String GA4_BASE_URL = "https://www.google-analytics.com";
    private static final String COLLECT_PATH = "/mp/collect";
    private static final String ENV_PARAM = "env";

    private final RestClient restClient;
    private final Ga4Properties properties;
    private final String env;

    public Ga4MeasurementClientImpl(
            Ga4Properties properties,
            // Track2(user-activity) 로그와 같은 소스를 써서 두 트랙의 env 값이 어긋나지 않게 한다
            @Value("${spring.profiles.active:local}") String env) {
        this.properties = properties;
        this.env = env;
        this.restClient = RestClient.builder().baseUrl(GA4_BASE_URL).build();
    }

    /**
     * 앱스트림 이벤트. {@code appInstanceId}(GA4 app_instance_id)가 없으면 전송하지 않는다 —
     * 유저 귀속 이벤트를 웹스트림으로 폴백하면 세션이 어긋나기 때문(스펙 §4-3).
     */
    @Override
    @Async("ga4Executor")
    public void sendAppEvent(String appInstanceId, String name, Map<String, Object> params) {
        if (isBlank(appInstanceId)) {
            log.debug("GA4 앱스트림 미전송 — app_instance_id 없음 (event={})", name);
            return;
        }
        if (isBlank(properties.getFirebaseAppId()) || isBlank(properties.getAppApiSecret())) {
            log.warn("GA4 앱스트림 설정 누락 — GA4_FIREBASE_APP_ID/GA4_APP_API_SECRET 확인 필요 (event={})", name);
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("app_instance_id", appInstanceId);
        body.put("events", List.of(event(name, params)));

        send(uriBuilder -> uriBuilder.path(COLLECT_PATH)
                .queryParam("firebase_app_id", properties.getFirebaseAppId())
                .queryParam("api_secret", properties.getAppApiSecret())
                .build(), body, name);
    }

    /**
     * 웹스트림 이벤트. {@code syntheticClientId} 는 실제 gtag client_id 가 아니라 서버가 만든 합성 값
     * (초대 링크 클릭 UUID) — 랜딩에 GA 태그를 심지 않고도 웹 퍼널 단계를 셀 수 있게 한다.
     */
    @Override
    @Async("ga4Executor")
    public void sendWebEvent(String syntheticClientId, String name, Map<String, Object> params) {
        if (isBlank(syntheticClientId)) {
            log.debug("GA4 웹스트림 미전송 — client_id 없음 (event={})", name);
            return;
        }
        if (isBlank(properties.getWebMeasurementId()) || isBlank(properties.getWebApiSecret())) {
            log.warn("GA4 웹스트림 설정 누락 — GA4_WEB_MEASUREMENT_ID/GA4_WEB_API_SECRET 확인 필요 (event={})", name);
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("client_id", syntheticClientId);
        body.put("events", List.of(event(name, params)));

        send(uriBuilder -> uriBuilder.path(COLLECT_PATH)
                .queryParam("measurement_id", properties.getWebMeasurementId())
                .queryParam("api_secret", properties.getWebApiSecret())
                .build(), body, name);
    }

    /**
     * 이벤트 1건 조립. {@code env}(dev/prod)는 스펙 §4-3 요구사항이라 호출 지점마다 넣게 두지 않고
     * 여기서 채운다 — 호출자가 이미 넣었으면 그 값을 존중한다. null 값 파라미터는 GA4 가 거부하므로 제거.
     */
    private Map<String, Object> event(String name, Map<String, Object> params) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (params != null) {
            params.forEach((key, value) -> {
                if (value != null) {
                    merged.put(key, value);
                }
            });
        }
        merged.putIfAbsent(ENV_PARAM, env);
        return Map.of("name", name, "params", merged);
    }

    /** 전송 + 전면 fail-safe. 어떤 실패도 호출측으로 전파하지 않는다. */
    private void send(Function<UriBuilder, URI> uriFunction, Map<String, Object> body, String eventName) {
        try {
            restClient.post()
                    .uri(uriFunction)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            // 분석 이벤트 유실은 수용 — 재시도하지 않는다(중복 집계가 유실보다 나쁘다)
            log.warn("GA4 MP 전송 실패 — event={}, cause={}", eventName, e.getMessage());
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}

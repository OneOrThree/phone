package com.oneorthree.phone.common.analytics;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * GA4 Measurement Protocol 설정 (스펙 §6-2).
 *
 * <p>스트림이 2개다 — 앱스트림(firebase-app-id + app-api-secret)과 웹스트림(web-measurement-id +
 * web-api-secret). 시크릿은 전부 env 로만 주입하며 저장소에 값을 두지 않는다.
 *
 * <p>{@code enabled} 가 true 일 때만 {@link Ga4MeasurementClientImpl} 이 활성화되고, 미설정(dev·local)
 * 에서는 no-op 구현이 뜬다. 코드베이스에 {@code @ConfigurationPropertiesScan} 이 없어 {@code @Component}
 * 로 자립 등록한다.
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "ga4")
public class Ga4Properties {

    /** 실전송 활성화 여부 — prod 만 true. 미설정 시 no-op 구현이 뜬다. */
    private boolean enabled;

    /** 앱스트림: Firebase 앱 ID (GA4_FIREBASE_APP_ID). */
    private String firebaseAppId;

    /** 앱스트림: Measurement Protocol API secret (GA4_APP_API_SECRET). */
    private String appApiSecret;

    /** 웹스트림: 측정 ID G-XXXXXXX (GA4_WEB_MEASUREMENT_ID). */
    private String webMeasurementId;

    /** 웹스트림: Measurement Protocol API secret (GA4_WEB_API_SECRET). */
    private String webApiSecret;
}

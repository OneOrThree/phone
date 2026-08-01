package com.oneorthree.phone.common.analytics;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withRawStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * GA4 Measurement Protocol 클라이언트 단위 테스트 (스펙 §6-2).
 *
 * <p>HTTP 왕복은 {@link MockRestServiceServer} 로 stub 한다(선례: {@code FcmPushNotificationClientTest}).
 * {@code @Async} 는 프록시가 붙는 컨테이너에서만 동작하므로 직접 생성한 이 테스트에서는 동기 실행된다 —
 * 검증하려는 건 스레딩이 아니라 페이로드 조립과 실패 격리다.
 */
class Ga4MeasurementClientImplTest {

    private static final String APP_COLLECT_URL =
            "https://www.google-analytics.com/mp/collect?firebase_app_id=1:123:ios:abc&api_secret=app-secret";
    private static final String WEB_COLLECT_URL =
            "https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=web-secret";

    private Ga4MeasurementClientImpl client;
    private MockRestServiceServer mockServer;

    @BeforeEach
    void setUp() {
        Ga4Properties properties = new Ga4Properties();
        properties.setEnabled(true);
        properties.setFirebaseAppId("1:123:ios:abc");
        properties.setAppApiSecret("app-secret");
        properties.setWebMeasurementId("G-TEST123");
        properties.setWebApiSecret("web-secret");

        client = new Ga4MeasurementClientImpl(properties, "prod");

        RestClient.Builder builder = RestClient.builder().baseUrl("https://www.google-analytics.com");
        mockServer = MockRestServiceServer.bindTo(builder).build();
        ReflectionTestUtils.setField(client, "restClient", builder.build());
    }

    @Test
    @DisplayName("앱스트림 이벤트는 firebase_app_id 와 app_instance_id 로 전송된다")
    void sendsAppEventWithFirebaseAppIdAndInstanceId() {
        mockServer.expect(requestTo(APP_COLLECT_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.app_instance_id").value("inst1"))
                .andExpect(jsonPath("$.events[0].name").value("group_joined"))
                .andExpect(jsonPath("$.events[0].params.group_id").value("g-1"))
                .andRespond(withSuccess());

        client.sendAppEvent("inst1", "group_joined", Map.of("group_id", "g-1"));

        mockServer.verify();
    }

    @Test
    @DisplayName("웹스트림 이벤트는 measurement_id 와 client_id 로 전송된다")
    void sendsWebEventWithMeasurementIdAndClientId() {
        mockServer.expect(requestTo(WEB_COLLECT_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.client_id").value("click-uuid"))
                .andExpect(jsonPath("$.events[0].name").value("invite_link_clicked"))
                .andExpect(jsonPath("$.events[0].params.slug").value("ab23cd45"))
                .andRespond(withSuccess());

        client.sendWebEvent("click-uuid", "invite_link_clicked", Map.of("slug", "ab23cd45"));

        mockServer.verify();
    }

    @Test
    @DisplayName("모든 서버 이벤트에 env 파라미터가 동봉된다")
    void attachesEnvParamToEveryEvent() {
        mockServer.expect(requestTo(APP_COLLECT_URL))
                .andExpect(jsonPath("$.events[0].params.env").value("prod"))
                .andRespond(withSuccess());

        client.sendAppEvent("inst1", "group_joined", Map.of("group_id", "g-1"));

        mockServer.verify();
    }

    @Test
    @DisplayName("null 값 파라미터는 제거된다 — GA4 가 거부하는 페이로드를 만들지 않는다")
    void dropsNullValuedParams() {
        mockServer.expect(requestTo(APP_COLLECT_URL))
                .andExpect(jsonPath("$.events[0].params.slug").doesNotExist())
                .andExpect(jsonPath("$.events[0].params.group_id").value("g-1"))
                .andRespond(withSuccess());

        Map<String, Object> params = new HashMap<>();
        params.put("group_id", "g-1");
        params.put("slug", null);
        client.sendAppEvent("inst1", "group_joined", params);

        mockServer.verify();
    }

    @Test
    @DisplayName("전송 실패는 예외를 삼키고 WARN 로그만 남긴다")
    void swallowsTransportFailure() {
        mockServer.expect(requestTo(APP_COLLECT_URL))
                .andRespond(withRawStatus(500).body("{\"error\":\"internal\"}"));

        assertThatCode(() -> client.sendAppEvent("inst1", "group_joined", Map.of("group_id", "g-1")))
                .doesNotThrowAnyException();

        mockServer.verify();
    }

    @Test
    @DisplayName("app_instance_id 가 없으면 앱스트림 전송을 건너뛴다 — 웹스트림 폴백 금지")
    void skipsAppEventWithoutInstanceId() {
        // 기대 요청을 등록하지 않았으므로, 전송이 일어나면 MockRestServiceServer 가 실패시킨다
        client.sendAppEvent(null, "group_joined", Map.of("group_id", "g-1"));

        mockServer.verify();
    }

    @Test
    @DisplayName("시크릿이 비어 있으면 전송하지 않는다 — 배선 누락은 WARN 으로만 드러낸다")
    void skipsWhenSecretsMissing() {
        Ga4Properties empty = new Ga4Properties();
        empty.setEnabled(true);
        Ga4MeasurementClientImpl unconfigured = new Ga4MeasurementClientImpl(empty, "prod");
        ReflectionTestUtils.setField(unconfigured, "restClient",
                ReflectionTestUtils.getField(client, "restClient"));

        assertThatCode(() -> {
            unconfigured.sendAppEvent("inst1", "group_joined", Map.of());
            unconfigured.sendWebEvent("client-1", "invite_link_clicked", Map.of());
        }).doesNotThrowAnyException();

        mockServer.verify();
    }
}

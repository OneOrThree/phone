package com.oneorthree.phone.notification.client;

import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushSendResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.Date;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withRawStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * FCM 클라이언트 단위 테스트 (GROMO-528 커밋②).
 * HTTP 왕복 자체는 dev 배포 후 수동 트리거로 확인 — 여기선 조립/매핑 메서드만.
 *
 * <p>메시지 JSON 조립은 package-private {@code buildMessagePayload} 직접 호출로,
 * 응답 상태 → PushSendResult 매핑은 {@link MockRestServiceServer} 로 검증한다.
 * 생성자의 GoogleCredentials 초기화·refreshIfExpired 는 실제 네트워크가 필요하므로
 * 리플렉션으로 restClient/credentials 필드를 테스트용 mock 으로 교체한다.
 */
class FcmPushNotificationClientTest {

    private static final String PROJECT_ID = "gromo-test";
    private static final String SEND_URL =
            "https://fcm.googleapis.com/v1/projects/" + PROJECT_ID + "/messages:send";
    private static final String DEVICE_TOKEN = "fcm-registration-token";

    private FcmPushNotificationClient client;
    private MockRestServiceServer mockServer;

    @BeforeEach
    void setUp() throws Exception {
        // 실제 서비스 계정 JSON(유효한 RSA 키 포함) 으로 생성자 fail-fast 를 통과시킨다.
        String serviceAccountJsonBase64 =
                Base64.getEncoder().encodeToString(minimalServiceAccountJson().getBytes());
        client = new FcmPushNotificationClient(PROJECT_ID, serviceAccountJsonBase64);

        // send() 가 실제 OAuth2 네트워크 갱신을 타지 않도록 credentials 를 mock 으로 교체.
        GoogleCredentials credentials = mock(GoogleCredentials.class);
        when(credentials.getAccessToken())
                .thenReturn(new AccessToken("test-access-token", new Date(System.currentTimeMillis() + 3_600_000)));
        ReflectionTestUtils.setField(client, "credentials", credentials);

        // RestClient 를 MockRestServiceServer 에 바인딩해 HTTP 왕복을 stub.
        RestClient.Builder builder = RestClient.builder().baseUrl("https://fcm.googleapis.com");
        mockServer = MockRestServiceServer.bindTo(builder).build();
        ReflectionTestUtils.setField(client, "restClient", builder.build());
    }

    // ── 메시지 JSON 조립 (package-private buildMessagePayload) ──────────────────

    @Test
    @DisplayName("조립 - title/body/data.link 매핑")
    void buildPayloadMapsTitleBodyLink() {
        PushMessage message = new PushMessage("제목", "본문", "gromo://league", false);

        Map<String, Object> payload = client.buildMessagePayload(DEVICE_TOKEN, message);

        @SuppressWarnings("unchecked")
        Map<String, Object> fcmMessage = (Map<String, Object>) payload.get("message");
        assertThat(fcmMessage.get("token")).isEqualTo(DEVICE_TOKEN);
        assertThat(fcmMessage.get("notification")).isEqualTo(Map.of("title", "제목", "body", "본문"));
        assertThat(fcmMessage.get("data")).isEqualTo(Map.of("link", "gromo://league"));
    }

    @Test
    @DisplayName("조립 - soundEnabled true → apns.payload.aps.sound = default 포함")
    void buildPayloadIncludesSoundWhenEnabled() {
        PushMessage message = new PushMessage("제목", "본문", "gromo://league", true);

        Map<String, Object> payload = client.buildMessagePayload(DEVICE_TOKEN, message);

        @SuppressWarnings("unchecked")
        Map<String, Object> fcmMessage = (Map<String, Object>) payload.get("message");
        assertThat(fcmMessage).containsKey("apns");
        assertThat(fcmMessage.get("apns"))
                .isEqualTo(Map.of("payload", Map.of("aps", Map.of("sound", "default"))));
    }

    @Test
    @DisplayName("조립 - soundEnabled false → apns 블록 생략")
    void buildPayloadOmitsSoundWhenDisabled() {
        PushMessage message = new PushMessage("제목", "본문", "gromo://league", false);

        Map<String, Object> payload = client.buildMessagePayload(DEVICE_TOKEN, message);

        @SuppressWarnings("unchecked")
        Map<String, Object> fcmMessage = (Map<String, Object>) payload.get("message");
        assertThat(fcmMessage).doesNotContainKey("apns");
    }

    // ── 응답 상태 → PushSendResult 매핑 ────────────────────────────────────────

    @Test
    @DisplayName("매핑 - 200 → SENT")
    void mapsSuccessToSent() {
        mockServer.expect(requestTo(SEND_URL))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{}", org.springframework.http.MediaType.APPLICATION_JSON));

        PushSendResult result = client.send(DEVICE_TOKEN, sample());

        assertThat(result).isEqualTo(PushSendResult.SENT);
        mockServer.verify();
    }

    @Test
    @DisplayName("매핑 - 404 UNREGISTERED → INVALID_TOKEN")
    void maps404UnregisteredToInvalidToken() {
        mockServer.expect(requestTo(SEND_URL))
                .andRespond(withRawStatus(404)
                        .body("{\"error\":{\"status\":\"NOT_FOUND\",\"details\":[{\"errorCode\":\"UNREGISTERED\"}]}}")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON));

        PushSendResult result = client.send(DEVICE_TOKEN, sample());

        assertThat(result).isEqualTo(PushSendResult.INVALID_TOKEN);
        mockServer.verify();
    }

    @Test
    @DisplayName("매핑 - 400 INVALID_ARGUMENT → INVALID_TOKEN")
    void maps400InvalidArgumentToInvalidToken() {
        mockServer.expect(requestTo(SEND_URL))
                .andRespond(withRawStatus(400)
                        .body("{\"error\":{\"status\":\"INVALID_ARGUMENT\",\"message\":\"invalid registration token\"}}")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON));

        PushSendResult result = client.send(DEVICE_TOKEN, sample());

        assertThat(result).isEqualTo(PushSendResult.INVALID_TOKEN);
        mockServer.verify();
    }

    @Test
    @DisplayName("매핑 - 500 → FAILED (재시도 없음)")
    void maps500ToFailed() {
        mockServer.expect(requestTo(SEND_URL))
                .andRespond(withRawStatus(500)
                        .body("{\"error\":{\"status\":\"INTERNAL\"}}")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON));

        PushSendResult result = client.send(DEVICE_TOKEN, sample());

        assertThat(result).isEqualTo(PushSendResult.FAILED);
        mockServer.verify();
    }

    private static PushMessage sample() {
        return new PushMessage("제목", "본문", "gromo://league", true);
    }

    // 유효한 RSA private key 를 담은 최소 service_account JSON — 생성자의 GoogleCredentials 파싱 통과용.
    // (네트워크는 credentials mock 으로 대체하므로 이 키로 실제 토큰 발급은 하지 않는다.)
    private static String minimalServiceAccountJson() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        // 단일 라인 base64 + JSON escape(\n) 로 PEM 조립 — GoogleCredentials 파싱만 통과하면 된다
        // (실제 토큰 발급은 credentials mock 이 대체하므로 이 키로 네트워크를 타지 않는다).
        String privateKeyPem = "-----BEGIN PRIVATE KEY-----\\n"
                + Base64.getEncoder().encodeToString(keyPair.getPrivate().getEncoded())
                + "\\n-----END PRIVATE KEY-----\\n";
        return "{"
                + "\"type\":\"service_account\","
                + "\"project_id\":\"" + PROJECT_ID + "\","
                + "\"private_key_id\":\"test-key-id\","
                + "\"private_key\":\"" + privateKeyPem + "\","
                + "\"client_email\":\"fcm@" + PROJECT_ID + ".iam.gserviceaccount.com\","
                + "\"client_id\":\"1234567890\","
                + "\"token_uri\":\"https://oauth2.googleapis.com/token\""
                + "}";
    }
}

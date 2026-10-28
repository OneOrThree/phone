package com.oneorthree.phone.focus.client;

import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ApnsLiveActivityClientTest {
    @Test
    @SuppressWarnings("unchecked")
    void signsProviderTokenAndRoutesSandboxAndProductionWithoutRealNetwork() throws Exception {
        var generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        var pair = generator.generateKeyPair();
        String pem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----";
        var http = mock(HttpClient.class);
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);
        var client = new ApnsLiveActivityClient("TEAM123", "KEY123",
                Base64.getEncoder().encodeToString(pem.getBytes(StandardCharsets.UTF_8)), http);
        assertThat(client.send("ab".repeat(32), "development", Map.of("aps", Map.of("event", "update"))))
                .isEqualTo(LiveActivityPushClient.Result.SENT);
        client.send("ab".repeat(32), "production", Map.of("aps", Map.of("event", "end")));
        var capture = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http, times(2)).send(capture.capture(), any(HttpResponse.BodyHandler.class));
        var update = capture.getAllValues().get(0);
        var end = capture.getAllValues().get(1);
        assertThat(update.uri().getHost()).isEqualTo("api.sandbox.push.apple.com");
        assertThat(end.uri().getHost()).isEqualTo("api.push.apple.com");
        assertThat(update.headers().firstValue("apns-topic")).contains("com.oneorthree.focuscat.push-type.liveactivity");
        assertThat(update.headers().firstValue("apns-expiration")).contains("0");
        assertThat(end.headers().firstValue("apns-expiration")).isNotEqualTo(java.util.Optional.of("0"));
        String jwt = update.headers().firstValue("authorization").orElseThrow().substring(7);
        var parsed = Jwts.parser().verifyWith((ECPublicKey) pair.getPublic()).build().parseSignedClaims(jwt);
        assertThat(parsed.getHeader().getKeyId()).isEqualTo("KEY123");
        assertThat(parsed.getPayload().getIssuer()).isEqualTo("TEAM123");
        when(response.statusCode()).thenReturn(410);
        when(response.body()).thenReturn("{\"reason\":\"Unregistered\"}");
        assertThat(client.send("ab".repeat(32), "production", Map.of()))
                .isEqualTo(LiveActivityPushClient.Result.INVALID_TOKEN);
        when(response.statusCode()).thenReturn(503);
        when(response.body()).thenReturn("{\"reason\":\"ServiceUnavailable\"}");
        assertThat(client.send("ab".repeat(32), "production", Map.of()))
                .isEqualTo(LiveActivityPushClient.Result.RETRY);
    }

    @Test
    void missingKeyDoesNotPretendToSend() {
        var client = new ApnsLiveActivityClient("", "", "");
        assertThat(client.enabled()).isFalse();
        assertThat(client.send("ab", "development", Map.of())).isEqualTo(LiveActivityPushClient.Result.RETRY);
    }
}

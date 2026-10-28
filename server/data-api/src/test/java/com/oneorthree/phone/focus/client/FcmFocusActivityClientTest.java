package com.oneorthree.phone.focus.client;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class FcmFocusActivityClientTest {
    private final HttpClient http = mock(HttpClient.class);
    private final String token = "private-fcm-token";
    private final GoogleCredentials credentials = GoogleCredentials.create(
            new AccessToken("test-access-token", Date.from(Instant.now().plusSeconds(3600))));
    private final FcmFocusActivityClient client = new FcmFocusActivityClient("catus-dev", credentials, http);

    @Test
    @SuppressWarnings("unchecked")
    void senderMismatchInvalidatesTokenWithoutLoggingIt() throws Exception {
        var logger = (Logger) LoggerFactory.getLogger(FcmFocusActivityClient.class);
        var logs = new ListAppender<ILoggingEvent>();
        logs.start();
        logger.addAppender(logs);
        try {
            respond(403, """
                    {"error":{"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError",
                    "errorCode":"SENDER_ID_MISMATCH"}]}}
                    """);
            assertThat(client.send(token, Map.of("sessionId", "session-1")))
                    .isEqualTo(LiveActivityPushClient.Result.INVALID_TOKEN);
            assertThat(logs.list).anySatisfy(event -> {
                assertThat(event.getFormattedMessage()).contains("catus-dev").doesNotContain(token);
            });
        } finally {
            logger.detachAppender(logs);
            logs.stop();
        }
    }

    @Test
    void unregisteredStillInvalidatesToken() throws Exception {
        respond(404, """
                {"error":{"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError",
                "errorCode":"UNREGISTERED"}]}}
                """);
        assertThat(client.send(token, Map.of("sessionId", "session-1")))
                .isEqualTo(LiveActivityPushClient.Result.INVALID_TOKEN);
    }

    @Test
    void other403AndServerFailureRemainRetryable() throws Exception {
        respond(403, """
                {"error":{"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError",
                "errorCode":"INVALID_ARGUMENT"}]}}
                """);
        assertThat(client.send(token, Map.of("sessionId", "session-1")))
                .isEqualTo(LiveActivityPushClient.Result.RETRY);
        respond(503, "{}");
        assertThat(client.send(token, Map.of("sessionId", "session-1")))
                .isEqualTo(LiveActivityPushClient.Result.RETRY);
    }

    @Test
    void missingCredentialsDoNotSend() {
        var disabled = new FcmFocusActivityClient("", null, http);
        assertThat(disabled.enabled()).isFalse();
        assertThat(disabled.send(token, Map.of("sessionId", "session-1")))
                .isEqualTo(LiveActivityPushClient.Result.RETRY);
    }

    @SuppressWarnings("unchecked")
    private void respond(int status, String body) throws Exception {
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(status);
        when(response.body()).thenReturn(body);
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);
    }
}

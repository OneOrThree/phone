package com.oneorthree.realtime.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WebSocketConnectionDiagnosticsTest {

    private static final String RUN_ID = "17e1faf5-7094-4aa6-a5be-83ac87d12345";
    private static final String CONNECTION_ID = "e747898c-c78a-4ac6-8631-4f89ce1db973";
    private final WebSocketConnectionDiagnostics diagnostics = new WebSocketConnectionDiagnostics();

    private Map<String, Object> handshake(String query) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/ws/realtime");
        request.setQueryString(query);
        Map<String, Object> attributes = new HashMap<>();
        assertThat(diagnostics.beforeHandshake(new ServletServerHttpRequest(request), null, null, attributes)).isTrue();
        return attributes;
    }

    @Test
    void handshakeRetainsOnlyTwoCanonicalUuidHints() {
        Map<String, Object> attributes = handshake("loadtestRunId=" + RUN_ID + "&loadtestConnectionId=" + CONNECTION_ID
                + "&token=synthetic-secret&other=user%40example.com");
        assertThat(attributes).hasSize(1);
        assertThat(attributes.toString()).contains(RUN_ID, CONNECTION_ID).doesNotContain("secret", "example.com");
        assertThat(handshake("loadtestRunId=" + RUN_ID + "&loadtestConnectionId=invalid-secret")).isEmpty();
        assertThat(handshake("loadtestRunId=" + RUN_ID + "&loadtestRunId=" + RUN_ID
                + "&loadtestConnectionId=" + CONNECTION_ID)).isEmpty();
        assertThat(handshake("loadtestRunId=1-1-1-1-1&loadtestConnectionId=" + CONNECTION_ID)).isEmpty();
        assertThat(handshake("loadtestRunId=" + RUN_ID + "%0Asecret&loadtestConnectionId=" + CONNECTION_ID)).isEmpty();
    }

    @Test
    void closeAndTransportExceptionsStillDelegateAndRecordWithoutPrivateText() throws Exception {
        WebSocketHandler delegate = mock(WebSocketHandler.class);
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("socket-1");
        when(session.getAttributes()).thenReturn(handshake("loadtestRunId=" + RUN_ID
                + "&loadtestConnectionId=" + CONNECTION_ID));
        CloseStatus status = new CloseStatus(1008, "user@example.com Bearer synthetic-secret");
        IOException failure = new IOException("Bearer synthetic-secret");
        doThrow(failure).when(delegate).afterConnectionClosed(session, status);
        doThrow(failure).when(delegate).handleTransportError(session, failure);
        Logger logger = (Logger) LoggerFactory.getLogger(WebSocketConnectionDiagnostics.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            WebSocketHandler handler = diagnostics.decorate(delegate);
            assertThatThrownBy(() -> handler.afterConnectionClosed(session, status)).isSameAs(failure);
            assertThatThrownBy(() -> handler.handleTransportError(session, failure)).isSameAs(failure);
            verify(delegate).afterConnectionClosed(session, status);
            verify(delegate).handleTransportError(session, failure);
            assertThat(appender.list).hasSize(2);
            assertThat(appender.list.get(0).getFormattedMessage()).contains("event=CLOSED", "close_code=1008",
                    "initiator=UNKNOWN", "root_cause=UNKNOWN", "server_socket_id=socket-1",
                    "cleanup=NOT_OBSERVED", RUN_ID, CONNECTION_ID);
            assertThat(appender.list.get(1).getFormattedMessage()).contains("event=TRANSPORT_ERROR");
            when(session.getId()).thenReturn("user@example.com Bearer synthetic-secret");
            assertThatThrownBy(() -> handler.afterConnectionClosed(session, status)).isSameAs(failure);
            assertThat(appender.list.get(2).getFormattedMessage()).contains("server_socket_id=UNKNOWN");
            assertThat(appender.list).allSatisfy(event -> assertThat(event.getFormattedMessage())
                    .doesNotContain("synthetic-secret", "example.com", "Bearer"));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}

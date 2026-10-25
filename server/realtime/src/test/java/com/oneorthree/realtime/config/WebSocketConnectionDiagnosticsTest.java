package com.oneorthree.realtime.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.realtime.auth.ChatPrincipal;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WebSocketConnectionDiagnosticsTest {

    private static final String RUN_ID = "17e1faf5-7094-4aa6-a5be-83ac87d12345";
    private static final String CONNECTION_ID = "e747898c-c78a-4ac6-8631-4f89ce1db973";
    private static final String USER_ID = "0b3c8f4e-5d6a-4b7c-9e8f-1a2b3c4d5e6f";
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
        Map<String, Object> attributes = handshake("loadtestRunId=" + RUN_ID + "&loadtestConnectionId=" + CONNECTION_ID);
        // 인증 뒤 세션에 붙는 주체(사용자 ID·AT 원문)와 다른 속성도 로그로 새지 않아야 한다.
        attributes.put("userId", USER_ID);
        when(session.getAttributes()).thenReturn(attributes);
        when(session.getPrincipal())
                .thenReturn(new ChatPrincipal(UUID.fromString(USER_ID), "Bearer synthetic-secret"));
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
                    "close_reason=OTHER", "initiator=UNKNOWN", "root_cause=UNKNOWN", "server_socket_id=socket-1",
                    "cleanup=NOT_OBSERVED", RUN_ID, CONNECTION_ID);
            assertThat(appender.list.get(1).getFormattedMessage()).contains("event=TRANSPORT_ERROR");
            when(session.getId()).thenReturn("user@example.com Bearer synthetic-secret");
            assertThatThrownBy(() -> handler.afterConnectionClosed(session, status)).isSameAs(failure);
            assertThat(appender.list.get(2).getFormattedMessage()).contains("server_socket_id=UNKNOWN");
            // 서버가 고른 오류 코드 모양의 reason 만 그대로 남는다 — 클라이언트 로그와 종료 원인을 대조하는 근거.
            handler.afterConnectionClosed(session, OutboundSendBudget.QUEUE_FULL);
            assertThat(appender.list.get(3).getFormattedMessage())
                    .contains("close_code=1008", "close_reason=OUTBOUND_QUEUE_FULL");
            assertThat(appender.list).allSatisfy(event -> assertThat(event.getFormattedMessage())
                    .doesNotContain("synthetic-secret", "example.com", "Bearer", USER_ID));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}

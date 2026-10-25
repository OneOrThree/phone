package com.oneorthree.realtime.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 클라이언트 UUID 둘을 상관관계 힌트로만 보존한다. 인증된 사용자나 서버가 검증한 원인으로 취급하지 않는다.
 * 원문 URI·기타 쿼리·종료 reason·예외 메시지·토큰은 기록하지 않는다. 관측은 기존 종료 정리를 가로막지 않는다.
 */
@Slf4j
final class WebSocketConnectionDiagnostics implements HandshakeInterceptor, WebSocketHandlerDecoratorFactory {

    private static final String ATTRIBUTE = WebSocketConnectionDiagnostics.class.getName();
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private static final Pattern SOCKET_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,128}");

    private record Correlation(String runId, String connectionId) {
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler handler, Map<String, Object> attributes) {
        attributes.remove(ATTRIBUTE);
        var query = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams();
        String runId = singleUuid(query.get("loadtestRunId"));
        String connectionId = singleUuid(query.get("loadtestConnectionId"));
        if (runId != null && connectionId != null) {
            attributes.put(ATTRIBUTE, new Correlation(runId, connectionId));
        }
        // 힌트 누락·오류는 관측만 생략하며 기존 인증 및 핸드셰이크 정책을 바꾸지 않는다.
        return true;
    }

    private static String singleUuid(List<String> values) {
        if (values == null || values.size() != 1 || values.get(0) == null) {
            return null;
        }
        String value = values.get(0);
        return UUID_PATTERN.matcher(value).matches() ? value.toLowerCase(java.util.Locale.ROOT) : null;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler handler, Exception exception) {
        // 실패 응답은 기존 핸드셰이크 경로가 처리한다. 원문 예외를 진단 로그에 추가하지 않는다.
    }

    @Override
    public WebSocketHandler decorate(WebSocketHandler handler) {
        return new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                try {
                    super.afterConnectionEstablished(session);
                    record(session, "ESTABLISHED", null);
                } catch (Exception exception) {
                    record(session, "ESTABLISH_FAILED", null);
                    throw exception;
                }
            }

            @Override
            public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
                try {
                    super.handleTransportError(session, exception);
                } finally {
                    record(session, "TRANSPORT_ERROR", null);
                }
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
                try {
                    super.afterConnectionClosed(session, status);
                } finally {
                    record(session, "CLOSED", status.getCode());
                }
            }
        };
    }

    private static void record(WebSocketSession session, String event, Integer code) {
        // 이 ID는 서버 WebSocket 세션 ID다. 로그인 인증 세션 ID나 사용자 ID를 읽지 않는다.
        String socketId = session.getId();
        if (socketId == null || !SOCKET_ID_PATTERN.matcher(socketId).matches()) {
            socketId = "UNKNOWN";
        }
        if (session.getAttributes().get(ATTRIBUTE) instanceof Correlation correlation) {
            // CLOSED는 콜백 관측이다. 바깥 decorator의 캐시·이동 정리 완료를 뜻하지 않는다.
            log.info("websocket_connection at={} client_run_id={} client_connection_id={} server_socket_id={} "
                            + "event={} close_code={} initiator=UNKNOWN root_cause=UNKNOWN cleanup=NOT_OBSERVED",
                    Instant.now(), correlation.runId(), correlation.connectionId(), socketId, event, code);
        }
    }
}

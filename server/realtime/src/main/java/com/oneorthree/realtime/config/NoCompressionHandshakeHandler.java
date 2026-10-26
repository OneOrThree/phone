package com.oneorthree.realtime.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.server.HandshakeHandler;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;

import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;

/**
 * 등록한 STOMP 경로에서는 WebSocket 확장을 협상하지 않는다. 인증·Origin·STOMP 프로토콜은 보존한다.
 *
 * <p>Spring 7의 확장 필터만 비우면 Tomcat 11 UpgradeUtil이 내장 확장을 다시 추가한다. 따라서 실제 Servlet
 * 요청에서 확장 제안 전체를 제외해 최종 협상까지 같은 정책을 적용한다. 헤더를 직접 파싱하지 않으므로
 * 컨테이너와의 파서 차이로 압축 제안이 다시 노출되지 않는다. 응답 헤더를 사후 삭제하지 않는다.
 * DefaultHandshakeHandler의 검증과 StandardWebSocketUpgradeStrategy는 그대로 사용한다.
 */
final class NoCompressionHandshakeHandler implements HandshakeHandler {

    private static final String EXTENSIONS = WebSocketHttpHeaders.SEC_WEBSOCKET_EXTENSIONS;

    private final HandshakeHandler delegate;

    NoCompressionHandshakeHandler() {
        this(new DefaultHandshakeHandler());
    }

    NoCompressionHandshakeHandler(HandshakeHandler delegate) {
        this.delegate = delegate;
    }

    @Override
    public boolean doHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)) {
            throw new IllegalArgumentException("STOMP handshake에는 Servlet 요청이 필요합니다");
        }
        HttpServletRequest original = servletRequest.getServletRequest();
        HttpServletRequest wrapped = new HttpServletRequestWrapper(original) {
            @Override
            public String getHeader(String name) {
                return EXTENSIONS.equalsIgnoreCase(name) ? null : super.getHeader(name);
            }

            @Override
            public Enumeration<String> getHeaders(String name) {
                return EXTENSIONS.equalsIgnoreCase(name) ? Collections.emptyEnumeration() : super.getHeaders(name);
            }

            @Override
            public Enumeration<String> getHeaderNames() {
                List<String> names = Collections.list(super.getHeaderNames());
                names.removeIf(EXTENSIONS::equalsIgnoreCase);
                return Collections.enumeration(names);
            }
        };
        return delegate.doHandshake(new ServletServerHttpRequest(wrapped), response, wsHandler, attributes);
    }

}

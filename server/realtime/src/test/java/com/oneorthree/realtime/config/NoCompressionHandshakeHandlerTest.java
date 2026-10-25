package com.oneorthree.realtime.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.socket.WebSocketHandler;

import java.util.Collections;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class NoCompressionHandshakeHandlerTest {

    @Test
    @DisplayName("여러 확장 헤더 전체를 제외하고 나머지 요청과 원본을 보존한다")
    void allExtensionOffersAreRemoved() {
        MockHttpServletRequest original = new MockHttpServletRequest();
        original.addHeader("sec-websocket-extensions", "permessage-deflate; client_max_window_bits, other; p=\"a,b\"");
        original.addHeader("sec-websocket-extensions", "PERMESSAGE-DEFLATE, final; p=\"a\\\",b\"");
        original.addHeader("Sec-WebSocket-Protocol", "v12.stomp");
        original.addHeader("Origin", "https://allowed.example");
        original.setUserPrincipal(() -> "unchanged-principal");
        AtomicReference<ServletServerHttpRequest> captured = new AtomicReference<>();
        NoCompressionHandshakeHandler handler = new NoCompressionHandshakeHandler((request, response, ws, attrs) -> {
            captured.set((ServletServerHttpRequest) request);
            return true;
        });

        assertThat(handler.doHandshake(new ServletServerHttpRequest(original), null, mock(WebSocketHandler.class), Map.of()))
                .isTrue();
        var wrapped = captured.get().getServletRequest();
        assertThat(Collections.list(wrapped.getHeaders("SEC-WEBSOCKET-EXTENSIONS"))).isEmpty();
        assertThat(wrapped.getHeader("Sec-WebSocket-Extensions")).isNull();
        assertThat(wrapped.getHeader("Sec-WebSocket-Protocol")).isEqualTo("v12.stomp");
        assertThat(wrapped.getHeader("Origin")).isEqualTo("https://allowed.example");
        assertThat(wrapped.getUserPrincipal()).isSameAs(original.getUserPrincipal());
        assertThat(original.getHeader("sec-websocket-extensions")).startsWith("permessage-deflate");
    }

    @Test
    @DisplayName("비정상 quoted 제안도 세 가지 헤더 조회 경로 모두에서 사라진다")
    void emptyExtensionListIsAbsentInEveryServletHeaderAccess() {
        MockHttpServletRequest original = new MockHttpServletRequest();
        original.addHeader("sEc-WeBsOcKeT-ExTeNsIoNs", "x\", permessage-deflate");
        NoCompressionHandshakeHandler handler = new NoCompressionHandshakeHandler((request, response, ws, attrs) -> {
            var wrapped = ((ServletServerHttpRequest) request).getServletRequest();
            assertThat(wrapped.getHeader("Sec-WebSocket-Extensions")).isNull();
            assertThat(Collections.list(wrapped.getHeaders("Sec-WebSocket-Extensions"))).isEmpty();
            assertThat(Collections.list(wrapped.getHeaderNames())).noneMatch(name -> name.equalsIgnoreCase("Sec-WebSocket-Extensions"));
            assertThat(request.getHeaders().get("Sec-WebSocket-Extensions")).isNull();
            return true;
        });
        assertThat(handler.doHandshake(new ServletServerHttpRequest(original), null, mock(WebSocketHandler.class), Map.of()))
                .isTrue();
    }
}

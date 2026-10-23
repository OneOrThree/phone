package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.AuthAttributes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 로그 상관 ID 의 출처 — X-Trace-Id → X-Request-Id → 새로 생성 (GROMO-2195).
 *
 * <p>business-api·realtime 이 보내는 X-Request-Id 를 이어받지 못하면 한 요청이 호출한 쪽과 이쪽 로그에서
 * 다른 trace_id 로 갈라진다. 반대로 검사 없이 받으면 헤더 값이 그대로 로그 줄에 실린다.
 */
class TraceIdFilterTest {

    private static final String HEX_32 = "[0-9a-f]{32}";

    /** 체인 안에서 본 MDC 값 (필터가 체인을 부르는 시점의 값). */
    private String seenTraceId;
    private String seenUserId;

    private final FilterChain capturingChain = (request, response) -> {
        seenTraceId = MDC.get("trace_id");
        seenUserId = MDC.get("user_id");
    };

    @BeforeEach
    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    private void run(MockHttpServletRequest request, FilterChain chain) throws Exception {
        new TraceIdFilter().doFilter(request, new MockHttpServletResponse(), chain);
    }

    private static MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/users/notification-snapshot");
        request.setRequestURI("/internal/users/notification-snapshot");
        return request;
    }

    @Test
    @DisplayName("X-Trace-Id 가 있으면 그 값을 trace_id 로 쓴다 — X-Request-Id 보다 우선한다")
    void X_Trace_Id_가_있으면_그_값을_쓴다() throws Exception {
        MockHttpServletRequest request = request();
        request.addHeader("X-Trace-Id", "app-trace_01");
        request.addHeader("X-Request-Id", UUID.randomUUID().toString());

        run(request, capturingChain);

        assertThat(seenTraceId).isEqualTo("app-trace_01");
    }

    @Test
    @DisplayName("X-Trace-Id 가 없으면 X-Request-Id(UUID) 를 trace_id 로 이어받는다")
    void X_Trace_Id_가_없으면_X_Request_Id_를_이어받는다() throws Exception {
        String requestId = UUID.randomUUID().toString();
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", requestId);

        run(request, capturingChain);

        assertThat(seenTraceId).isEqualTo(requestId);
    }

    @Test
    @DisplayName("X-Trace-Id 가 공백뿐이어도 X-Request-Id 를 이어받는다")
    void X_Trace_Id_가_공백뿐이면_X_Request_Id_를_이어받는다() throws Exception {
        String requestId = UUID.randomUUID().toString();
        MockHttpServletRequest request = request();
        request.addHeader("X-Trace-Id", "   ");
        request.addHeader("X-Request-Id", requestId);

        run(request, capturingChain);

        assertThat(seenTraceId).isEqualTo(requestId);
    }

    @Test
    @DisplayName("헤더 값 앞뒤 공백은 걷어 낸다")
    void 헤더_값_앞뒤_공백은_걷어_낸다() throws Exception {
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", "  req-1  ");

        run(request, capturingChain);

        assertThat(seenTraceId).isEqualTo("req-1");
    }

    @Test
    @DisplayName("둘 다 없으면 하이픈 없는 32자 hex 를 새로 만든다")
    void 둘_다_없으면_32자_hex_를_새로_만든다() throws Exception {
        run(request(), capturingChain);

        assertThat(seenTraceId).matches(HEX_32);
    }

    @Test
    @DisplayName("128자까지는 이어받는다")
    void 길이_128자까지는_이어받는다() throws Exception {
        String requestId = "a".repeat(128);
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", requestId);

        run(request, capturingChain);

        assertThat(seenTraceId).isEqualTo(requestId);
    }

    @Test
    @DisplayName("129자부터는 이어받지 않고 새로 만든다")
    void 길이_129자부터는_새로_만든다() throws Exception {
        String requestId = "a".repeat(129);
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", requestId);

        run(request, capturingChain);

        assertThat(seenTraceId).matches(HEX_32).isNotEqualTo(requestId);
    }

    @ParameterizedTest(name = "[{index}] X-Request-Id 가 검사 밖이면 이어받지 않고 새로 만든다")
    @ValueSource(strings = {"req;drop", "req id", "req\nforged-line", "한글"})
    @DisplayName("X-Request-Id 가 허용 문자 밖이면 새로 만든다")
    void X_Request_Id_가_검사_밖이면_새로_만든다(String requestId) throws Exception {
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", requestId);

        run(request, capturingChain);

        assertThat(seenTraceId).matches(HEX_32).isNotEqualTo(requestId);
    }

    @Test
    @DisplayName("X-Trace-Id 가 검사 밖이어도 새로 만든다")
    void X_Trace_Id_가_검사_밖이어도_새로_만든다() throws Exception {
        MockHttpServletRequest request = request();
        request.addHeader("X-Trace-Id", "t;1");

        run(request, capturingChain);

        assertThat(seenTraceId).matches(HEX_32);
    }

    @Test
    @DisplayName("요청 속성 userId 가 있으면 MDC user_id 에 싣고, 없으면 싣지 않는다")
    void 요청_속성_userId_를_MDC_에_싣는다() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest authenticated = request();
        authenticated.setAttribute(AuthAttributes.USER_ID, userId);

        run(authenticated, capturingChain);
        assertThat(seenUserId).isEqualTo(userId.toString());

        run(request(), capturingChain);
        assertThat(seenUserId).isNull();
    }

    @Test
    @DisplayName("체인이 끝나면 MDC 를 비운다")
    void 체인이_끝나면_MDC_를_비운다() throws Exception {
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", "req-1");
        request.setAttribute(AuthAttributes.USER_ID, UUID.randomUUID());

        run(request, capturingChain);

        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }

    @Test
    @DisplayName("체인에서 예외가 나도 MDC 를 비운다 — 재사용되는 스레드가 값을 물려받지 않는다")
    void 체인에서_예외가_나도_MDC_를_비운다() {
        FilterChain failingChain = (request, response) -> {
            throw new ServletException("체인 실패");
        };
        MockHttpServletRequest request = request();
        request.addHeader("X-Request-Id", "req-1");
        request.setAttribute(AuthAttributes.USER_ID, UUID.randomUUID());

        assertThatThrownBy(() -> run(request, failingChain)).isInstanceOf(ServletException.class);

        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }
}

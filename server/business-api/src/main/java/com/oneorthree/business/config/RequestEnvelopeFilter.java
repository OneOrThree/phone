package com.oneorthree.business.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 인증과 무관한 «요청 봉투» — 추적 id · 캐시 금지 · 본문 상한.
 *
 * <h2>왜 인증 필터와 분리했나</h2>
 * <p>본문 상한은 <b>무인증 경로에 더 필요하다</b>. 인증 필터 안에 두면 {@code /l/match} 처럼 열려 있는
 * 경로가 상한 없이 노출되고, 거기는 정지 창 동안 구 앱 전체가 두드리는 외부 진입점이다. 그래서 이 필터를
 * 인증보다 <b>앞</b>(order 0)에 두어 공개·비공개를 가리지 않고 모든 요청에 적용한다.
 *
 * <h2>상한을 두 번 검사한다</h2>
 * <p>{@code Content-Length} 는 <b>선언값일 뿐</b>이다 — 없을 수도 있고(chunked) 거짓일 수도 있다. 선언이
 * 크면 읽기 전에 바로 거절하고(빠른 실패), 선언을 믿을 수 없는 경우를 위해 입력 스트림 자체를 세면서
 * 상한을 넘는 순간 끊는다. 둘 중 하나만 두면 각각 「거대한 chunked 본문」과 「불필요하게 읽고 나서 거절」이
 * 남는다.
 *
 * <p>상한 {@value #MAX_BODY} 바이트는 미리보기 배치의 최악값을 수용한다 — URL 4096 UTF-16 단위 × 10개 ×
 * JSON Unicode escape 최대 6바이트 + JSON 구조.
 */
@Slf4j
public class RequestEnvelopeFilter extends OncePerRequestFilter {

    /** 요청 추적 id 속성 키. 미리보기 핸들러가 {@code "requestId"} 리터럴로 읽는다(1747 계약). */
    public static final String REQUEST_ID = "requestId";

    static final int MAX_BODY = 256 * 1024;

    private static final String HEADER_REQUEST_ID = "X-Request-Id";
    private static final String TOO_LARGE = "REQUEST_TOO_LARGE";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String requestId = UUID.randomUUID().toString();
        long started = System.nanoTime();
        request.setAttribute(REQUEST_ID, requestId);
        response.setHeader(HEADER_REQUEST_ID, requestId);
        // 이 서비스의 응답은 전부 사용자별 값이거나 일회성이다. 중간 캐시가 한 사용자의 응답을
        // 다른 사용자에게 주는 일이 없도록 못 박는다.
        response.setHeader("Cache-Control", "no-store");
        try {
            if (request.getContentLengthLong() > MAX_BODY) {
                reject(response);
                return;
            }
            chain.doFilter(new LimitedBodyRequest(request), response);
        } finally {
            log.info("business_request request_id={} method={} status={} duration_ms={}", requestId,
                    request.getMethod(), response.getStatus(),
                    TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        }
    }

    private void reject(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // 문구가 한글이라 charset 을 못박는다 — 없으면 서블릿 기본 ISO-8859-1 로 깨져 나간다.
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":\"" + TOO_LARGE + "\",\"message\":\"요청을 처리할 수 없습니다.\"}");
    }

    /**
     * 선언된 길이를 믿지 않고 실제로 읽은 바이트를 세는 요청 래퍼.
     *
     * <p>스트림을 <b>미리 열지 않는다</b> — 본문이 없는 GET 에까지 {@code getInputStream()} 을 먼저
     * 부르면 그 뒤로 서블릿 컨테이너가 본문을 파라미터로 파싱할 수 없게 되고, 지금은 JSON 전용이라
     * 문제가 없지만 폼 엔드포인트가 하나 생기는 순간 원인을 찾기 어려운 빈 파라미터가 된다.
     */
    private static final class LimitedBodyRequest extends HttpServletRequestWrapper {

        private ServletInputStream limited;

        private LimitedBodyRequest(HttpServletRequest request) {
            super(request);
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (limited == null) {
                limited = limit(super.getInputStream());
            }
            return limited;
        }

        private static ServletInputStream limit(ServletInputStream source) {
            return new ServletInputStream() {
                private int count;

                @Override
                public int read() throws IOException {
                    int value = source.read();
                    if (value != -1 && ++count > MAX_BODY) {
                        throw new IOException(TOO_LARGE);
                    }
                    return value;
                }

                @Override
                public boolean isFinished() {
                    return source.isFinished();
                }

                @Override
                public boolean isReady() {
                    return source.isReady();
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    source.setReadListener(listener);
                }
            };
        }
    }
}

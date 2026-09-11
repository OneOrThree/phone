package com.oneorthree.business.config;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.api.RequestBodyTooLargeException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** 인증 앞에서 서버 추적 ID, 캐시 금지, 256KiB 실제 본문 제한과 외부 사용자 헤더 폐기를 적용한다. */
@Slf4j
@RequiredArgsConstructor
public class RequestEnvelopeFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID = "requestId";

    static final int MAX_BODY = 256 * 1024;

    private static final String HEADER_USER_ID = "X-User-Id";
    private final ApiResponses responses;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String requestId = UUID.randomUUID().toString();
        long started = System.nanoTime();
        request.setAttribute(REQUEST_ID, requestId);
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Cache-Control", "no-store");
        if (request.getHeader(HEADER_USER_ID) != null) {
            log.warn("외부 사용자 신원 헤더를 폐기했다");
        }
        try {
            if (request.getContentLengthLong() > MAX_BODY) {
                reject(request, response);
                return;
            }
            chain.doFilter(new LimitedBodyRequest(request), response);
        } catch (IOException | ServletException error) {
            if (!RequestBodyTooLargeException.causedBy(error) || response.isCommitted()) {
                throw error;
            }
            response.resetBuffer();
            reject(request, response);
        } finally {
            log.info("business_request request_id={} method={} status={} duration_ms={}", requestId,
                    request.getMethod(), response.getStatus(),
                    TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        }
    }

    private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
        responses.writeFilterError(request, response, ApiErrorCode.REQUEST_TOO_LARGE, "요청을 처리할 수 없습니다.");
    }

    /** 본문을 미리 소비하지 않는다. reader와 stream 어느 쪽도 실제 바이트 상한을 우회할 수 없다. */
    private static final class LimitedBodyRequest extends HttpServletRequestWrapper {

        private ServletInputStream limited;
        private BufferedReader reader;

        private LimitedBodyRequest(HttpServletRequest request) {
            super(request);
        }

        @Override
        public String getHeader(String name) {
            return HEADER_USER_ID.equalsIgnoreCase(name) ? null : super.getHeader(name);
        }

        @Override
        public Enumeration<String> getHeaders(String name) {
            return HEADER_USER_ID.equalsIgnoreCase(name) ? Collections.emptyEnumeration() : super.getHeaders(name);
        }

        @Override
        public Enumeration<String> getHeaderNames() {
            return Collections.enumeration(Collections.list(super.getHeaderNames()).stream()
                    .filter(name -> !HEADER_USER_ID.equalsIgnoreCase(name)).toList());
        }

        @Override
        public int getIntHeader(String name) {
            return HEADER_USER_ID.equalsIgnoreCase(name) ? -1 : super.getIntHeader(name);
        }

        @Override
        public long getDateHeader(String name) {
            return HEADER_USER_ID.equalsIgnoreCase(name) ? -1 : super.getDateHeader(name);
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (limited == null) {
                limited = limit(super.getInputStream());
            }
            return limited;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            if (reader == null) {
                String encoding = getCharacterEncoding();
                reader = new BufferedReader(new InputStreamReader(getInputStream(),
                        encoding == null ? StandardCharsets.UTF_8.name() : encoding));
            }
            return reader;
        }

        private static ServletInputStream limit(ServletInputStream source) {
            return new ServletInputStream() {
                private int count;

                @Override
                public int read() throws IOException {
                    int value = source.read();
                    if (value != -1) {
                        checkLimit(1);
                    }
                    return value;
                }

                @Override
                public int read(byte[] bytes, int offset, int length) throws IOException {
                    int read = source.read(bytes, offset, Math.min(length, Math.max(1, MAX_BODY - count + 1)));
                    if (read > 0) {
                        checkLimit(read);
                    }
                    return read;
                }

                private void checkLimit(int read) throws RequestBodyTooLargeException {
                    count += read;
                    if (count > MAX_BODY) {
                        throw new RequestBodyTooLargeException();
                    }
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

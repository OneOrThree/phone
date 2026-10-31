package com.oneorthree.business.config;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.api.PublicApiRoutes;
import com.oneorthree.business.common.api.RequestBodyTooLargeException;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

import java.io.BufferedReader;
import java.io.IOException;

import com.oneorthree.business.common.logging.ObservationJsonProvider;
import com.oneorthree.business.common.logging.RequestLogContext;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/** 인증 앞에서 서버 추적 ID, 캐시 금지, 256KiB 실제 본문 제한과 외부 사용자 헤더 폐기를 적용한다. */
@Slf4j
@RequiredArgsConstructor
public class RequestEnvelopeFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID = "requestId";
    public static final String STRICT_ERROR_CONTRACT = "business.strictErrorContract";

    /** 형식이 어긋난 X-App-Version·X-App-Platform 요청 수 — 태그 {@code header} 는 헤더 이름 둘 중 하나뿐이다. */
    static final String APP_HEADER_INVALID = "business.request.app_header.invalid";

    static final int MAX_BODY = 256 * 1024;

    /**
     * 앱 semver(X.Y.Z). {@code ObservationJsonProvider.APP_VERSION} 과 같은 정규식이다 — 필터가 거르고 provider 가
     * 한 번 더 거르므로, 한쪽만 바꾸면 통과한 값이 다른 쪽에서 조용히 사라진다. 바꿀 때는 둘을 함께 바꾼다.
     */
    private static final Pattern APP_VERSION = Pattern.compile("[0-9]{1,9}\\.[0-9]{1,9}\\.[0-9]{1,9}");
    private static final String HEADER_USER_ID = "X-User-Id";
    private final ApiResponses responses;
    private final MeterRegistry metrics;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String requestId = UUID.randomUUID().toString();
        long started = System.nanoTime();
        request.setAttribute(REQUEST_ID, requestId);
        request.setAttribute(STRICT_ERROR_CONTRACT, PublicApiRoutes.usesEnvelope(request));
        response.setHeader("X-Request-Id", requestId);
        response.setHeader("Cache-Control", "no-store");
        try (RequestLogContext ignored = RequestLogContext.open(requestId)) {
            if (request.getHeader(HEADER_USER_ID) != null) {
                log.warn("외부 사용자 신원 헤더를 폐기했다");
            }
            boolean completed = false;
            try {
                if (request.getContentLengthLong() > MAX_BODY) {
                    reject(request, response);
                } else {
                    chain.doFilter(new LimitedBodyRequest(request), response);
                }
                completed = true;
            } catch (IOException | ServletException error) {
                if (!RequestBodyTooLargeException.causedBy(error) || response.isCommitted()) {
                    throw error;
                }
                response.resetBuffer();
                reject(request, response);
                completed = true;
            } finally {
                logAccess(request, response, started, completed);
            }
        }
    }

    /** 요청 완료 접근 로그. request_id 는 MDC 로 실리고, 구조화 필드는 ACCESS marker 의 key/value 로만 넘긴다. */
    private void logAccess(HttpServletRequest request, HttpServletResponse response, long started,
            boolean completed) {
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        LoggingEventBuilder access = log.atInfo().addMarker(ObservationJsonProvider.ACCESS)
                .addKeyValue("http_method", request.getMethod())
                .addKeyValue("http_route", route instanceof String pattern ? pattern : "unmatched")
                .addKeyValue("duration_ms", durationMs)
                .addKeyValue("outcome", completed ? "completed" : "unhandled_exception");
        // 클라이언트 헤더라 검증을 통과한 값만 싣고, 어긋나면 키를 생략한다(요청은 거절하지 않는다).
        String version = validAppHeader(request, "X-App-Version", v -> APP_VERSION.matcher(v).matches());
        if (version != null) {
            access = access.addKeyValue("app_version", version);
        }
        String platform = validAppHeader(request, "X-App-Platform", p -> "ios".equals(p) || "android".equals(p));
        if (platform != null) {
            access = access.addKeyValue("app_platform", platform);
        }
        if (completed) {
            // 예외가 빠져나가면 최종 상태는 컨테이너가 정하므로 싣지 않는다.
            access = access.addKeyValue("status_code", response.getStatus());
        }
        access.log("business_request method={} status={} duration_ms={}", request.getMethod(),
                completed ? response.getStatus() : "unhandled_exception", durationMs);
    }

    /**
     * 앱 헤더를 앞뒤 공백을 걷어 읽는다(두 헤더가 같은 규칙). 없거나 비어 있으면 «없음»이라 null 이고 세지 않는다 —
     * 헬스체크·웹 요청은 정상적으로 안 보낸다. 형식이 어긋나면 헤더 이름만 세고 null 이다. 원본 값은 태그에도 싣지 않는다.
     */
    private String validAppHeader(HttpServletRequest request, String name, Predicate<String> valid) {
        String raw = request.getHeader(name);
        String value = raw == null ? "" : raw.strip();
        if (value.isEmpty()) {
            return null;
        }
        if (valid.test(value)) {
            return value;
        }
        metrics.counter(APP_HEADER_INVALID, "header", name).increment();
        return null;
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

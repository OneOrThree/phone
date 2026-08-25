package com.oneorthree.phone._config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * 요청 본문 크기를 <b>역직렬화 전에</b> 차단하는 필터. 상한은 등록 시점에 경로별로 정한다({@link FilterConfig}).
 *
 * <p>DTO 의 {@code @Size} 검증은 Jackson 이 본문 전체를 힙에 읽어 객체로 만든 뒤에야 돈다 — 인증
 * 클라이언트가 한도보다 훨씬 큰 본문을 반복 전송하면 400 을 받기 전에 힙·처리 자원을 소모할 수 있다.
 * 이 필터는 역직렬화 전에 한도 초과 요청을 413 으로 즉시 끊는다({@code @Size} 와 이중 방어).</p>
 *
 * <p><b>chunked 요청(GROMO-1252 코드리뷰 6차 ③)</b>: {@code Transfer-Encoding: chunked} 면
 * {@code Content-Length} 가 없어 {@code getContentLengthLong()} 이 -1 이다. 종전엔 이걸 그냥 통과시켜
 * <b>헤더 하나를 생략하는 것만으로 가드가 무력화</b>됐다 — 이제 상한+1 바이트까지만 읽어 판정하고,
 * 통과한 본문은 캐시해 뒤단이 그대로 다시 읽게 한다. 읽는 양이 상한으로 제한되므로 임의 크기 본문이
 * 힙에 들어오지 않는다. 상한은 경로별로 유지된다(모더레이션 12MiB / 집중 세션 8KiB).</p>
 */
@Slf4j
@RequiredArgsConstructor
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    /** 와이어 바이트 상한 — 초과 시 413. */
    private final long maxWireBytes;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        long contentLength = request.getContentLengthLong();
        if (contentLength > maxWireBytes) {
            reject(request, response, contentLength);
            return;
        }
        if (contentLength < 0) {
            // 상한+1 바이트까지만 읽는다 — 초과 판정에 필요한 최소량이고, 이 이상은 힙에 담기지 않는다.
            byte[] body = request.getInputStream()
                    .readNBytes((int) Math.min(maxWireBytes + 1, Integer.MAX_VALUE));
            if (body.length > maxWireBytes) {
                reject(request, response, body.length);
                return;
            }
            filterChain.doFilter(new CachedBodyRequest(request, body), response);
            return;
        }
        filterChain.doFilter(request, response);
    }

    private void reject(HttpServletRequest request, HttpServletResponse response, long size) throws IOException {
        log.warn("요청 본문 초과 차단 — path={}, size={} (상한 {})", request.getRequestURI(), size, maxWireBytes);
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"PAYLOAD_TOO_LARGE\"}");
    }

    /** 이미 읽어 버린 본문을 뒤단(Jackson)이 그대로 다시 읽게 감싼다 — chunked 경로 전용. */
    private static final class CachedBodyRequest extends HttpServletRequestWrapper {

        private final byte[] body;

        private CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream source = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return source.read();
                }

                @Override
                public int read(byte[] buffer, int off, int len) {
                    return source.read(buffer, off, len);
                }

                @Override
                public boolean isFinished() {
                    return source.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    throw new UnsupportedOperationException("비동기 읽기 미지원 — 캐시된 본문");
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            Charset charset = encoding != null ? Charset.forName(encoding) : StandardCharsets.UTF_8;
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        // 본문을 다 읽어 길이를 알게 됐으므로 -1(chunked) 대신 실제 길이를 노출한다.
        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }
    }
}

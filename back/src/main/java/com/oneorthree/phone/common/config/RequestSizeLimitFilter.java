package com.oneorthree.phone.common.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 요청 본문 크기를 <b>역직렬화 전에</b> 차단하는 필터. 상한은 등록 시점에 경로별로 정한다({@link FilterConfig}).
 *
 * <p>DTO 의 {@code @Size} 검증은 Jackson 이 본문 전체를 힙에 읽어 객체로 만든 뒤에야 돈다 — 인증
 * 클라이언트가 한도보다 훨씬 큰 본문을 반복 전송하면 400 을 받기 전에 힙·처리 자원을 소모할 수 있다.
 * 이 필터는 Content-Length 헤더를 역직렬화 전에 검사해 한도 초과 요청을 413 으로 즉시 끊는다
 * ({@code @Size} 와 이중 방어).</p>
 *
 * <p>Content-Length 가 없는(chunked) 요청은 사전 판정이 불가능해 통과시키고 뒤단 {@code @Size} 에
 * 맡긴다 — 정직한 Content-Length 를 붙이는 일반 클라이언트의 대용량 전송 벡터 차단이 목적이다.</p>
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
            log.warn("요청 본문 초과 차단 — path={}, contentLength={} (상한 {})",
                    request.getRequestURI(), contentLength, maxWireBytes);
            response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"PAYLOAD_TOO_LARGE\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}

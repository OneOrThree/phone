package com.oneorthree.phone.common.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 이미지 모더레이션 요청 본문 크기를 역직렬화 전에 차단하는 필터.
 *
 * <p>{@code ImageModerationRequest.image} 의 {@code @Size} 검증은 Jackson 이 본문 전체를 힙에 읽어
 * 문자열로 만든 뒤에야 돈다 — Spring 이 직접 노출된 배포에서 인증 클라이언트가 한도보다 훨씬 큰
 * 본문을 반복 전송하면 400 을 받기 전에 힙·처리 자원을 소모할 수 있다. 이 필터는 Content-Length
 * 헤더를 역직렬화 전에 검사해 한도 초과 요청을 413 으로 즉시 끊는다({@code @Size} 와 이중 방어).</p>
 *
 * <p>Content-Length 가 없는(chunked) 요청은 사전 판정이 불가능해 통과시키고 뒤단 {@code @Size} 에
 * 맡긴다 — 정직한 Content-Length 를 붙이는 일반 클라이언트의 대용량 전송 벡터 차단이 목적이다.</p>
 */
@Slf4j
public class ModerationRequestSizeFilter extends OncePerRequestFilter {

    // ImageModerationRequest 의 @Size(max = 10MB) 와 맞추되 JSON 봉투(`{"image":"..."}`)·escape 여유로
    // 1KB 만 더한 상한. 정상 10MB 이미지는 통과하고, 그보다 큰 본문만 역직렬화 전에 끊는다.
    static final long MAX_BODY_BYTES = 10L * 1024 * 1024 + 1024;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        long contentLength = request.getContentLengthLong();
        if (contentLength > MAX_BODY_BYTES) {
            log.warn("모더레이션 요청 본문 초과 차단 — contentLength={} (상한 {})", contentLength, MAX_BODY_BYTES);
            response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"PAYLOAD_TOO_LARGE\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}

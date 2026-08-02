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

    // ImageModerationRequest 의 @Size 는 디코드된 base64 '문자열 길이'(≈10MiB)를 재지만, 이 필터가 보는
    // Content-Length 는 '와이어 바이트'다. JSON 직렬화가 base64 의 '/' 를 '\/' 로 이스케이프하면 와이어가
    // 문자열보다 커지므로(base64 의 '/' 비중 ~1.6% → 최대 수백 KB 증가), @Size 를 통과할 정상 요청이 좁은
    // 한도에 걸려 413 이 나는 걸 막기 위해 와이어 한도를 별도로 넉넉히(12MiB) 둔다. 실제 이미지 크기는
    // @Size 가 10MiB 로 정밀 차단하고, 이 필터는 그보다 훨씬 큰 본문만 역직렬화 전에 끊는다.
    static final long MAX_WIRE_BYTES = 12L * 1024 * 1024;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        long contentLength = request.getContentLengthLong();
        if (contentLength > MAX_WIRE_BYTES) {
            log.warn("모더레이션 요청 본문 초과 차단 — contentLength={} (상한 {})", contentLength, MAX_WIRE_BYTES);
            response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"PAYLOAD_TOO_LARGE\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}

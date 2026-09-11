package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.AuthAttributes;
import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code /api/*} 전용 인증 필터 — {@link FilterConfig} 가 그 경로에만 등록한다.
 *
 * <p>여기 걸리지 않는 경로는 셋이다. {@code /ws/**}(핸드셰이크 뒤 STOMP CONNECT 프레임에서
 * {@code StompAuthChannelInterceptor} 가 같은 검증을 한다), {@code /actuator/**}(관리 포트로 격리),
 * 그리고 에러 디스패치. <b>WebSocket 을 이 필터로 막지 않는 건 실수가 아니다</b> — 브라우저·RN 의
 * WebSocket 핸드셰이크는 임의 헤더를 못 싣는 경우가 있어 인증을 CONNECT 프레임으로 미룬 것이고,
 * 그래서 «핸드셰이크는 익명, 프레임에서 인증»이 이 서비스의 규칙이다.
 *
 * <p>거절은 이유를 구분하지 않고 401 하나로 통일한다 — 앱이 401 을 재로그인 트리거 하나로 처리한다.
 */
@RequiredArgsConstructor
public class JwtFilter extends OncePerRequestFilter {

    private final JwtValidator jwtValidator;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        Optional<UUID> userId = jwtValidator.extractUserId(extractToken(request));
        if (userId.isEmpty()) {
            sendUnauthorized(response);
            return;
        }

        request.setAttribute(AuthAttributes.USER_ID, userId.get());
        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return null;
        }
        return header.substring(7);
    }

    /**
     * 401 본문을 손으로 쓴다 — 필터는 {@code DispatcherServlet} 앞이라
     * {@code GlobalExceptionHandler} 가 닿지 않는다. 봉투 모양은 그쪽과 같아야 앱의 분기가 한 벌로 끝난다.
     */
    private void sendUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // 문구가 한글이라 charset 을 못박는다 — 없으면 서블릿 기본 ISO-8859-1 로 깨져 나간다.
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":\"" + CommonErrorCode.UNAUTHORIZED.name()
                + "\",\"message\":\"" + CommonErrorCode.UNAUTHORIZED.getMessage() + "\"}");
    }
}

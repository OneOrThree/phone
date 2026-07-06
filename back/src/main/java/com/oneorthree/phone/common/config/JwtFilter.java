package com.oneorthree.phone.common.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.user.service.UserActivityService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RequiredArgsConstructor
@Slf4j
public class JwtFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;
    private final UserActivityService userActivityService;

    private static final List<String> WHITELIST = List.of(
            "/api/v1/auth/kakao",
            "/api/v1/auth/guest",
            "/api/v1/auth/apple",
            "/api/v1/auth/google",
            "/api/v1/auth/line",
            "/api/v1/auth/instagram",
            "/api/v1/auth/facebook",
            "/api/v1/auth/refresh",
            // 테스트 푸시 발송 (GROMO-528) — 컨트롤러가 @Profile(local/dev/staging) 이라 prod 에선 404
            "/api/v1/notifications/test"
    );

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        if (WHITELIST.stream().anyMatch(request.getRequestURI()::startsWith)) {
            filterChain.doFilter(request, response);
            return;
        }

        String token = extractToken(request);

        if (token == null || !jwtProvider.isTokenValid(token)) {
            sendUnauthorized(response);
            return;
        }

        UUID userId = jwtProvider.extractUserId(token);
        request.setAttribute("userId", userId);
        // last_active_at 스로틀 갱신 (GROMO-578) — 미접속 복귀 푸시용 부가 데이터.
        // 하루 1회만 실쓰기(WHERE 가드). 갱신 실패가 요청 자체를 막지 않도록 예외 격리(요청은 그대로 진행).
        try {
            userActivityService.touchLastActive(userId, Instant.now());
        } catch (Exception e) {
            log.warn("last_active_at 갱신 실패 — userId={}", userId, e);
        }
        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");

        if (header == null || !header.startsWith("Bearer ")) {
            return null;
        }
        return header.substring(7);
    }

    private void sendUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"UNAUTHORIZED\"}");
    }
}

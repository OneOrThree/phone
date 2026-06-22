package com.oneorthree.phone.common.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

@RequiredArgsConstructor
public class JwtFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;

    private static final List<String> WHITELIST = List.of(
            "/api/v1/auth/kakao",
            "/api/v1/auth/guest",
            "/api/v1/auth/apple",
            "/api/v1/auth/refresh"
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

package com.oneorthree.phone.common.config;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.user.repository.UserRepository;
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
import java.util.Optional;
import java.util.UUID;

@RequiredArgsConstructor
@Slf4j
public class JwtFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;
    private final UserActivityService userActivityService;
    private final UserRepository userRepository;

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

        // access 타입만 통과 (GROMO-714) — 30일 refresh 토큰이 /api/* 를 직접 인증하던 경로를 막아
        // access 1시간 만료 정책을 실효화한다. 상수를 왼쪽에 둬 type 클레임이 없는 구 토큰(null)도
        // NPE 없이 거부한다(fail-closed).
        if (!JwtProvider.TYPE_ACCESS.equals(jwtProvider.extractType(token))) {
            sendUnauthorized(response);
            return;
        }

        UUID userId = jwtProvider.extractUserId(token);

        // 소프트딜리트(탈퇴) 유저 차단 (GROMO-827) — 서명이 아직 유효한 토큰이라도 is_deleted=true 면 인증 거부.
        // 탈퇴 시 소셜 연동·RT 는 파기되지만 이미 발급된 AT 는 만료까지 살아 있어, 이 PK 조회로 매 요청 최종 차단.
        // 차단 신호는 토큰 미제공/무효와 동일하게 401 로 통일(클라이언트는 401 을 재로그인 트리거로 처리).
        // 이 조회 하나가 활동 갱신 판정까지 겸한다 (GROMO-903) — empty 면 401, 값이 있으면 그대로 스로틀 판정에 쓴다.
        // 덕분에 인증 요청당 DB 왕복은 1회다(그날 첫 요청만 갱신 UPDATE 로 2회).
        Optional<Instant> lastActiveAt;
        try {
            lastActiveAt = userRepository.findLastActiveAtIfActive(userId);
        } catch (Exception e) {
            log.error("활성 유저 조회 실패 — userId={}", userId, e);
            sendUnauthorized(response);
            return;
        }
        if (lastActiveAt.isEmpty()) {
            sendUnauthorized(response);
            return;
        }

        // 인증 통과 — 이후 단계가 쓸 수 있게 userId 를 request 에 심는다 (GROMO-363).
        // 키 정의는 AuthAttributes 에 있고, 읽는 쪽은 LoginUserArgumentResolver 와 TraceIdFilter 다.
        request.setAttribute(AuthAttributes.USER_ID, userId);
        // last_active_at 스로틀 갱신 (GROMO-578) — 미접속 복귀 푸시용 부가 데이터.
        // 판정은 위 조회 결과로 이미 끝났다 — 그날 첫 요청에만 트랜잭션에 진입한다 (GROMO-903).
        // 갱신 실패가 요청 자체를 막지 않도록 예외 격리(요청은 그대로 진행).
        Instant now = Instant.now();
        if (userActivityService.needsTouch(lastActiveAt.orElse(null), now)) {
            try {
                userActivityService.touchLastActive(userId, now);
            } catch (Exception e) {
                log.warn("last_active_at 갱신 실패 — userId={}", userId, e);
            }
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

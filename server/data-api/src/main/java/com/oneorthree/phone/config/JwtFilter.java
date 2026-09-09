package com.oneorthree.phone.config;

import com.oneorthree.phone.common.exception.CommonErrorCode;
import com.oneorthree.phone.auth.support.JwtProvider;
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

/**
 * {@code /api/*} 전용 인증 필터 — {@link FilterConfig} 가 order 1 로 등록한다.
 * 이 경로에 걸리지 않는 URL({@code /link/**} 랜딩, {@code /.well-known/**}, actuator)은 미인증으로 열려 있다.
 *
 * <p>통과 조건은 네 가지를 모두 만족해야 한다 — 하나라도 어긋나면 이유를 구분하지 않고 401 로 통일한다
 * (클라이언트가 401 을 재로그인 트리거 하나로 처리하기 때문이다).
 * <ol>
 *   <li>{@code Authorization: Bearer …} 헤더가 있고 서명·만료가 유효할 것</li>
 *   <li>{@code type} 클레임이 {@code access} 일 것 — refresh 토큰(30일)이 API 를 직접 인증하던 경로를
 *       막아 access 1시간 만료 정책을 실효화한다. 비교를 상수 쪽에서 시작해 type 이 없는 구 토큰도
 *       NPE 없이 거부된다(fail-closed)</li>
 *   <li>해당 userId 가 소프트딜리트되지 않았을 것 — 탈퇴해도 이미 발급된 access 토큰은 만료까지
 *       서명이 유효하므로 매 요청 DB 로 최종 확인한다</li>
 *   <li>그 조회 자체가 예외 없이 끝날 것 — DB 장애 시 통과시키지 않고 거부한다</li>
 * </ol>
 *
 * <p>화이트리스트({@code /api/v1/auth/**}, 테스트 푸시)는 {@code startsWith} 접두 매칭이라
 * 항목을 추가할 때 다른 인증 경로를 접두로 삼키지 않는지 확인해야 한다.
 *
 * <p>통과하면 userId 를 {@code AuthAttributes.USER_ID} 로 request 에 심는다 — 읽는 쪽은
 * {@code LoginUserArgumentResolver} 와 {@link TraceIdFilter} 다. 마지막의 {@code last_active_at}
 * 갱신은 부가 작업이라 실패해도 요청을 막지 않는다.
 */
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
        // 판정은 위 조회 결과로 이미 끝났다 — 스로틀 창을 벗어났을 때만 트랜잭션에 진입한다 (GROMO-903).
        // 갱신 실패가 요청 자체를 막지 않도록 예외 격리(요청은 그대로 진행).
        // orElseThrow: 위 isEmpty 가드를 통과했으므로 값은 항상 존재한다. 비어 있다면 그건 가드가 깨진
        // 버그이므로 조용히 null 을 흘리지 않고 즉시 드러낸다(needsTouch 의 null fail-safe 는 서비스
        // public API 로서의 방어일 뿐, 이 호출부에서 기대하는 상태가 아니다).
        Instant now = Instant.now();
        if (userActivityService.needsTouch(lastActiveAt.orElseThrow(), now)) {
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

    /**
     * 401 응답을 직접 쓴다 — 필터 체인은 {@code DispatcherServlet} 앞이라 {@code GlobalExceptionHandler}
     * 가 닿지 않는다. 그래서 봉투({@code code}·{@code message})를 여기서 손으로 맞춘다 (GROMO-1657).
     * {@code error} 필드는 종전 모양의 별칭으로 남긴다 — 읽는 소비자는 확인된 바 없지만 빼면 계약 변경이다.
     */
    private void sendUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(envelope(CommonErrorCode.UNAUTHORIZED));
    }

    /** 필터용 봉투 — {@code ErrorResponse} 와 같은 필드에 종전 {@code error} 별칭을 더한 것. 문구는 상수라 이스케이프가 필요 없다. */
    static String envelope(CommonErrorCode code) {
        return "{\"error\":\"" + code.name() + "\",\"code\":\"" + code.name()
                + "\",\"message\":\"" + code.getMessage() + "\"}";
    }
}

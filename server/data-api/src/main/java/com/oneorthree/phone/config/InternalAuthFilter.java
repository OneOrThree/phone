package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.AuthAttributes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * {@code /internal/*} 전용 인증 필터 — 앱 JWT 와 <b>완전히 다른 축</b>이다 (A22 ㉸ · ㉱ · ㊀).
 *
 * <h2>왜 별도 필터인가</h2>
 * {@code JwtFilter} 는 {@code /api/*} 에만 걸리고 1661 전환 전까지 그대로 유지된다. 내부 표면은
 * <b>앱 JWT 로 인증하지 않는다</b> — 위성·Business 는 앱 토큰을 들고 있지 않고, 반대로 앱 토큰으로
 * 내부 명령에 닿을 수 있으면 「정상 AT 를 가진 사용자」가 임의 {@code X-User-Id} 로 남의 데이터를
 * 읽고 쓴다(㉸). 두 축을 한 필터에 합치면 그 경계가 조건문 하나로 좁아진다.
 *
 * <h2>통과 조건 넷</h2>
 * <ol>
 *   <li><b>켜져 있을 것</b> — caller 설정이 없으면 이 경로는 «존재하지 않는다»(404).</li>
 *   <li><b>{@code Authorization: Bearer} 가 알려진 caller 의 토큰일 것</b> — 비교는 상수 시간이다.</li>
 *   <li><b>그 caller 의 허용목록에 {@code METHOD + 경로} 가 있을 것</b>(㉱) — 이름만 나누면 최소
 *       권한이 안 선다.</li>
 *   <li><b>{@code X-User-Id} 가 UUID 이고, 경로에 유저가 있으면 그 값과 같을 것</b> — 다르면 배선
 *       사고이고, 통과시키면 그 자체가 남의 데이터 접근이다.</li>
 * </ol>
 *
 * <h2>거부 응답에 도메인 {@code code} 를 싣지 않는다</h2>
 * 계약상 <b>{@code code} 가 실린 4xx 는 도메인 판정</b>이라 Business 가 앱에 그대로 중계한다.
 * 여기서 나가는 거부는 전부 <b>배선·자격 문제</b>이지 사용자에게 보여 줄 판정이 아니다 — 코드를 실으면
 * 정상 세션이 서비스 토큰 오배선 때문에 재로그인으로 튄다. 코드 없는 401/403 은 Business 가 502 로
 * 올려 「우리 배포가 어긋났다」로 드러낸다.
 *
 * <h2>여기서 활성 검사를 하지 않는 이유</h2>
 * 「탈퇴자를 막는다」가 엔드포인트마다 다르기 때문이다 — 활성 검사 자체({@code …/activation})는
 * 비활성도 답해야 하고, 기기 토큰 삭제는 <b>탈퇴자도 자기 토큰을 지워야</b> 하며(그러지 않으면 이전
 * 계정 푸시가 그 기기로 계속 간다), 결과 ack 는 막아야 한다. 필터에 숨은 예외 목록을 두면 새
 * 엔드포인트가 어느 쪽인지 모른 채 조용히 한쪽으로 붙는다. 그래서 판정은 각 서비스가 명시적으로 한다.
 */
@Slf4j
public class InternalAuthFilter extends OncePerRequestFilter {

    /** 경로에서 유저를 읽는 자리 — {@code /internal/users/{userId}/…} 하나뿐이다. */
    private static final String USER_SCOPED_PREFIX = "/internal/users/";

    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();

    private final boolean enabled;

    /** 토큰 → caller 이름. 값이 아니라 «키»가 자격이라 이 맵을 로그에 찍지 않는다. */
    private final Map<String, String> callerByToken;

    /** caller 이름 → 허용 조합. */
    private final Map<String, List<AllowedCall>> allowByCaller;

    /**
     * @param properties 내부 표면 설정. 꺼져 있으면 어떤 caller 도 만들지 않는다
     */
    public InternalAuthFilter(InternalApiProperties properties) {
        this.enabled = properties.isEnabled() && !properties.getCallers().isEmpty();
        Map<String, String> tokens = new LinkedHashMap<>();
        Map<String, List<AllowedCall>> allow = new LinkedHashMap<>();
        if (this.enabled) {
            properties.getCallers().forEach((name, caller) -> {
                tokens.put(caller.getToken(), name);
                List<AllowedCall> parsed = new ArrayList<>();
                caller.getAllow().forEach(entry -> {
                    String[] parts = entry.trim().split("\\s+");
                    parsed.add(new AllowedCall(parts[0].toUpperCase(Locale.ROOT), parts[1]));
                });
                allow.put(name, List.copyOf(parsed));
            });
        }
        this.callerByToken = Map.copyOf(tokens);
        this.allowByCaller = Map.copyOf(allow);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        if (!enabled) {
            // 배선되지 않은 표면은 «없는» 표면이다. 401 로 답하면 「자격만 맞추면 열린다」는 신호가 된다.
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        String caller = resolveCaller(request.getHeader("Authorization"));
        if (caller == null) {
            // 코드 없는 401 = 우리 서비스 자격의 문제. Business 가 502 로 올린다.
            deny(response, HttpServletResponse.SC_UNAUTHORIZED, "service token rejected");
            return;
        }

        String path = request.getRequestURI();
        if (!isAllowed(caller, request.getMethod(), path)) {
            log.warn("내부 호출 거부 — caller={} {} {}", caller, request.getMethod(), path);
            deny(response, HttpServletResponse.SC_FORBIDDEN, "call not in allowlist");
            return;
        }

        UUID userId = null;
        String rawUserId = request.getHeader("X-User-Id");
        if (rawUserId != null && !rawUserId.isBlank()) {
            try {
                userId = UUID.fromString(rawUserId.trim());
            } catch (IllegalArgumentException e) {
                deny(response, HttpServletResponse.SC_BAD_REQUEST, "X-User-Id is not a uuid");
                return;
            }
        }

        UUID pathUserId = pathUserIdOf(path);
        if (pathUserId != null && !pathUserId.equals(userId)) {
            // 「경로의 대상 ≠ 헤더의 주체」는 언제나 배선 사고다. 통과시키면 그 순간 남의 데이터다.
            log.warn("내부 호출 거부 — caller={} 대상 불일치 {}", caller, path);
            deny(response, HttpServletResponse.SC_FORBIDDEN, "X-User-Id does not match path user");
            return;
        }

        if (userId != null) {
            // 통과한 주체를 request 에 심는다 — 읽는 쪽은 내부 컨트롤러다. JwtFilter 와 같은 키를 쓰므로
            // TraceIdFilter 가 붙는 날에도 유저 식별이 같은 자리에서 나온다.
            request.setAttribute(AuthAttributes.USER_ID, userId);
        }
        request.setAttribute(InternalCallAttributes.CALLER, caller);
        chain.doFilter(request, response);
    }

    /**
     * 토큰 → caller. <b>일치 여부를 상수 시간으로 비교한다</b> — 맵 조회로 끝내면 해시·equals 의
     * 조기 종료가 타이밍으로 새고, 토큰은 그 자체가 자격이다.
     */
    private String resolveCaller(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return null;
        }
        byte[] presented = authorization.substring(7).trim().getBytes(StandardCharsets.UTF_8);
        String matched = null;
        for (Map.Entry<String, String> entry : callerByToken.entrySet()) {
            if (MessageDigest.isEqual(entry.getKey().getBytes(StandardCharsets.UTF_8), presented)) {
                matched = entry.getValue();
            }
        }
        return matched;
    }

    private boolean isAllowed(String caller, String method, String path) {
        for (AllowedCall allowed : allowByCaller.getOrDefault(caller, List.of())) {
            if (allowed.method().equals(method) && PATH_MATCHER.match(allowed.pathPattern(), path)) {
                return true;
            }
        }
        return false;
    }

    /**
     * {@code /internal/users/{userId}/…} 의 유저 segment. 그 모양이 아니면 {@code null} 이다.
     *
     * <p>UUID 로 파싱되지 않으면 «유저 경로가 아니다»로 본다 — 여기서 400 을 내면 나중에
     * {@code /internal/users/summary} 같은 비유저 경로가 생겼을 때 통째로 막힌다.
     */
    private UUID pathUserIdOf(String path) {
        if (!path.startsWith(USER_SCOPED_PREFIX)) {
            return null;
        }
        String rest = path.substring(USER_SCOPED_PREFIX.length());
        int slash = rest.indexOf('/');
        String segment = slash < 0 ? rest : rest.substring(0, slash);
        try {
            return UUID.fromString(segment);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * 거부 응답 — <b>본문이 없다</b>. 도메인 {@code code} 를 실으면 Business 가 앱에 그대로 중계해
     * 배선 사고가 사용자 화면의 판정으로 둔갑한다.
     */
    private void deny(HttpServletResponse response, int status, String reason) {
        response.setStatus(status);
        response.setHeader("X-Internal-Deny-Reason", reason);
    }

    /** 허용 조합 하나. */
    private record AllowedCall(String method, String pathPattern) {
    }
}

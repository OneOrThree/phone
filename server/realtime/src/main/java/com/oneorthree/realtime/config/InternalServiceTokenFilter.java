package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.AuthAttributes;
import com.oneorthree.realtime.common.exception.CommonErrorCode;
import com.oneorthree.realtime.common.exception.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/**
 * {@code /internal/*} 전용 서비스 자격 필터 — 호출자는 Business 하나뿐이다 (island-mailbox LLD §3).
 *
 * <p>{@link JwtFilter} 와 «다른 축»이다. 그쪽은 앱 사용자의 AT 를 검증하고, 이쪽은 <b>서비스 토큰 +
 * 검증된 주체 위임({@code X-User-Id})</b>을 믿는다. Business 가 AT 를 검증하고 Data 로 인가를 끝낸 뒤
 * 주체만 넘기므로, 여기서 AT 를 다시 요구하면 Business 가 앱 헤더를 통째로 복사해야 하고 그게 곧
 * A22 ㉸ 위반이다. 반대로 서비스 토큰 없이 {@code X-User-Id} 만 믿으면 아무나 남의 이름으로 쓴다.
 *
 * <p>토큰이 설정에 비어 있으면 <b>전량 거절(fail-closed)</b>한다 — 부팅을 막지 않는 이유는 이 표면이
 * 아직 어느 배포에도 배선되지 않았기 때문이다. 환경변수 하나 빠졌다고 채팅 전체(STOMP·legacy REST)가
 * 안 뜨는 것보다, 내부 표면만 닫혀 있는 편이 낫다. 비교는 상수 시간이다 — 토큰은 그 자체가 자격이다.
 *
 * <p>거절 봉투는 {@code JwtFilter} 와 같은 {@code {code, message}} 다. Business 의 상류 클라이언트는
 * 코드 없는 401 을 «서비스 자격 거부»(502)로, 400 을 계약 오류로 접는다.
 */
public class InternalServiceTokenFilter extends OncePerRequestFilter {

    private static final String HEADER_USER_ID = "X-User-Id";

    /** 설정된 토큰의 바이트. 비어 있으면 {@code null} — 모든 호출을 거절한다. */
    private final byte[] expectedToken;

    public InternalServiceTokenFilter(String serviceToken) {
        this.expectedToken = serviceToken == null || serviceToken.isBlank()
                ? null : serviceToken.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (!tokenMatches(request.getHeader("Authorization"))) {
            reject(response, CommonErrorCode.UNAUTHORIZED);
            return;
        }
        UUID userId = parseUserId(request.getHeader(HEADER_USER_ID));
        if (userId == null) {
            // 주체 없는 내부 호출은 배선 사고다 — 통과시키면 @LoginUser 리졸버가 500 으로 터진다.
            reject(response, CommonErrorCode.INVALID_REQUEST);
            return;
        }
        request.setAttribute(AuthAttributes.USER_ID, userId);
        filterChain.doFilter(request, response);
    }

    private boolean tokenMatches(String header) {
        if (expectedToken == null || header == null || !header.startsWith("Bearer ")) {
            return false;
        }
        byte[] presented = header.substring(7).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expectedToken, presented);
    }

    private static UUID parseUserId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(raw.trim());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static void reject(HttpServletResponse response, ErrorCode code) throws IOException {
        response.setStatus(code.getStatus().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":\"" + code.name()
                + "\",\"message\":\"" + code.getMessage() + "\"}");
    }
}

package com.oneorthree.business.config;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.auth.AuthAttributes;
import com.oneorthree.business.common.exception.CommonErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;

/**
 * {@code /api/*} 전용 인증 필터 — 이 서비스의 <b>보안 경계</b>다.
 *
 * <h2>두 가지를 한다</h2>
 * <ol>
 *   <li><b>AT 검증</b>: 서명 · 만료 · {@code type=access} · subject UUID. refresh 토큰은 서명이 맞아도
 *       거절한다 — 같은 키로 서명되므로 서명 검증만으로는 구분되지 않고, 수명 30일 RT 로 위성 쓰기에
 *       닿게 되면 AT 1시간 만료 정책이 통째로 무력화된다.</li>
 *   <li><b>외부 {@code X-User-Id} 폐기</b>(A22 ㉸): 이 필터를 통과한 뒤로 <b>인바운드 헤더에서 온
 *       사용자 신원은 존재하지 않는다</b>. 값은 검증한 AT 의 subject 뿐이고, 그 값은 요청 속성으로만
 *       흐른다. 헤더를 지우는 대신 «읽지 않는» 구조를 택했다 — 서블릿 요청 헤더는 불변이라 물리적
 *       삭제가 불가능하고, 지운 척하는 래퍼는 누군가 원본을 다시 꺼내면 무의미해진다. 아웃바운드는
 *       {@code InternalCall} 이 인바운드 헤더를 복사할 통로를 아예 갖고 있지 않다.</li>
 * </ol>
 *
 * <p>외부에서 {@code X-User-Id} 가 실려 오면 <b>거절하지 않고 무시</b>하되 경고를 남긴다. 거절하면
 * 프록시가 습관적으로 그 헤더를 붙이는 환경에서 정상 요청이 전부 막히고, 무시하면 위조 시도가
 * 조용히 지나간다 — 무시 + 관측이 둘 사이의 답이다.
 *
 * <p>거절은 이유를 구분하지 않고 401 하나로 통일한다 — 앱이 401 을 재로그인 트리거 하나로 처리한다.
 */
@Slf4j
@RequiredArgsConstructor
public class AccessTokenFilter extends OncePerRequestFilter {

    private static final String HEADER_USER_ID = "X-User-Id";

    private final AccessTokenVerifier verifier;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        if (request.getHeader(HEADER_USER_ID) != null) {
            // 값은 로그에 남기지 않는다 — 위조 시도라도 실제 userId 일 수 있다.
            log.warn("외부 X-User-Id 헤더를 폐기했다 — path={}", request.getRequestURI());
        }

        Optional<AccessTokenClaims> claims = verifier.verify(extractToken(request));
        if (claims.isEmpty()) {
            sendUnauthorized(response);
            return;
        }

        request.setAttribute(AuthAttributes.CLAIMS, claims.get());
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
     * 401 본문을 손으로 쓴다 — 필터는 {@code DispatcherServlet} 앞이라 전역 핸들러가 닿지 않는다.
     * 봉투 모양은 그쪽과 같아야 앱의 분기가 한 벌로 끝난다.
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

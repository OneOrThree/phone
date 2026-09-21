package com.oneorthree.business.config;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.auth.AuthAttributes;
import com.oneorthree.business.auth.GuestDeviceCredentials;
import com.oneorthree.business.auth.LoginAttemptCredentials;
import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.auth.RefreshCredentials;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.exception.CommonErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;
import java.util.Set;

/**
 * 기존 및 신규 외부 REST의 인증 필터 — 정확히 열거한 공개 경로 외에는 AT가 필요하다.
 *
 * <h2>두 가지를 한다</h2>
 * <ol>
 *   <li><b>AT 검증</b>: 서명 · 만료 · {@code type=access} · subject UUID. refresh 토큰은 서명이 맞아도
 *       거절한다 — 같은 키로 서명되므로 서명 검증만으로는 구분되지 않고, 수명 30일 RT 로 위성 쓰기에
 *       닿게 되면 AT 1시간 만료 정책이 통째로 무력화된다.</li>
 *   <li><b>외부 {@code X-User-Id} 폐기</b>(A22 ㉸): 이 필터를 통과한 뒤로 <b>인바운드 헤더에서 온
 *       사용자 신원은 존재하지 않는다</b>. 값은 검증한 AT 의 subject 뿐이고, 그 값은 요청 속성으로만
 *       흐른다. 앞의 {@link RequestEnvelopeFilter}가 모든 헤더 접근자에서 외부 사용자 헤더를 제거한다.
 *       아웃바운드는 {@code InternalCall}이 인바운드 헤더를 복사할 통로를 갖지 않는다.</li>
 * </ol>
 *
 * <p>외부에서 {@code X-User-Id} 가 실려 오면 <b>거절하지 않고 무시</b>하되 경고를 남긴다. 거절하면
 * 프록시가 습관적으로 그 헤더를 붙이는 환경에서 정상 요청이 전부 막히고, 무시하면 위조 시도가
 * 조용히 지나간다 — 무시 + 관측이 둘 사이의 답이다.
 *
 * <p>거절은 이유를 구분하지 않고 401 하나로 통일한다 — 앱이 401 을 재로그인 트리거 하나로 처리한다.
 *
 * <h2>경로 선택은 «전부 막고 열거한 것만 연다»</h2>
 * <p>이 필터는 {@code /*} 에 등록되고, {@link #PUBLIC_PATHS} 에 <b>정확히 일치</b>하는 요청만 통과시킨다.
 * 접두어로 «인증 대상»을 고르면(예: {@code /api/} 로 시작할 때만 검사) 우회가 가능하다 — MVC 는 경로를
 * 디코딩하고 matrix parameter 를 제거하므로 {@code /%61pi/v1/...} 와 {@code /api;v=1/v1/...} 가
 * <b>같은 컨트롤러로 라우팅되면서 접두어 검사에는 걸리지 않는다</b>. 비교를 {@code getRequestURI()}
 * (디코딩 전 원문)의 정확 일치로 두면 그런 변형은 목록에 없으므로 fail-closed 로 401 이 된다.
 *
 * <p>무인증 공개 경로는 세 종류다 — 컨테이너 헬스체크({@code /health}), 이관 정지 창의 무인증 구 앱
 * 매치({@code /l/match}), 관리 엔드포인트(포트 9091 로 격리돼 있고 서비스 포트로 부르면 404 여야 한다).
 * RT-only 로그아웃은 별도로 정확한 DELETE 경로에서만 AT 생략을 허용하고, Data가 RT를 검증한다.
 */
@Slf4j
@RequiredArgsConstructor
public class AccessTokenFilter extends OncePerRequestFilter {

    private static final String HEADER_USER_ID = "X-User-Id";
    private static final String HEADER_AUTHORIZATION = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    /**
     * 인증 없이 지나갈 수 있는 경로 — <b>이 목록에 없는 모든 요청은 401</b>이다.
     *
     * <p>비교는 {@code getRequestURI()} 의 정확 일치다. 접두어·정규화된 경로로 비교하면 인코딩·matrix
     * parameter 변형이 우회로가 된다.
     */
    private static final Set<String> PUBLIC_PATHS = Set.of(
            // compose 헬스체크. 관리 포트 9091 은 호스트에 publish 하지 않으므로 서비스 포트에 둔다.
            "/health",
            // 이관 정지 창의 구 앱 deferred 매치. 여기 닿는 사람은 아직 우리 유저가 아니다(설치 직후).
            "/l/match",
            // 관리 엔드포인트. 실제로는 포트 9091 의 별도 컨텍스트라 이 필터가 닿지 않지만, 서비스 포트로
            // 불렸을 때 «401 이 아니라 404» 여야 한다 — 401 이면 포트 격리가 라우팅 문제를 가린다.
            "/actuator", "/actuator/health", "/actuator/health/liveness",
            "/actuator/health/readiness", "/actuator/info", "/actuator/prometheus");

    /**
     * Authorization 헤더 길이 상한. 정상 AT 는 1KiB 를 넘지 않는다 — 이보다 긴 값은 서명 검증에
     * CPU 를 태우게 하려는 입력이므로 파서에 넘기기 전에 자른다.
     */
    private static final int MAX_AUTHORIZATION_LENGTH = 8192;

    private final AccessTokenVerifier verifier;
    private final ApiResponses responses;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return PUBLIC_PATHS.contains(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        if (request.getHeader(HEADER_USER_ID) != null) {
            // 값은 로그에 남기지 않는다 — 위조 시도라도 실제 userId 일 수 있다.
            log.warn("외부 X-User-Id 헤더를 폐기했다 — path={}", request.getRequestURI());
        }

        // AT 재발급만 «AT 가 있어도 검증하지 않는다» — 이 요청이 오는 정상적인 상황이 곧 「AT 가
        // 만료됐다」라서, 만료 AT 를 401 로 끊으면 앱의 401 처리가 다시 갱신을 불러 401 → 갱신 → 401
        // 루프가 된다(GROMO-2035 가 없애려는 「한 시간마다 로그아웃」과 같은 증상이다).
        //
        // ⚠️ 「검증 없이 통과한 AT」가 권한이 되지는 않는다: 이 경로의 컨트롤러·유스케이스는
        //    Authorization 을 «읽지 않고»(RefreshCredentials), 주체는 Data 가 RT 서명에서 직접 확인한다.
        //    아래 AuthAttributes 도 심지 않으므로 @LoginUser 로 흘러갈 값 자체가 없다.
        if (RefreshCredentials.matches(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        // 사용자 자격이 «우리 AT 가 아닌» 세 raw method/path 만 AT 생략을 허용한다.
        //   · DELETE /auth/sessions/current — RT 가 인증 정본이다(Data 가 검증한다)
        //   · POST   /auth/sessions        — 제공자 자격이 인증 정본이다. 최초 로그인에는 AT 가
        //                                     아예 없으므로, 열지 않으면 «로그인 자체가 401» 이다
        //   · POST   /auth/sessions/guest  — 같은 이유. 게스트 시작에는 제시할 자격이 아예 없다
        //                                     (GROMO-2036). 기기 식별자는 멱등 키이지 인증이 아니다
        //
        // ⚠️ 여는 조건은 「AT 가 없을 때」뿐이다. AT 를 실었다면 아래로 내려가 평소처럼 검증되고,
        //    실패하면 401 이다 — 계정 LLD §2.1 의 「잘못된 AT 를 익명 로그인으로 조용히 강등하지
        //    않는다」. 여기서 무조건 통과시키면 폐기된 게스트의 AT 를 든 요청이 「AT 없는 신규
        //    로그인」으로 지나가 게스트 승격 관문이 통째로 무의미해진다.
        //
        // ⚠️ PUBLIC_PATHS 에 넣지 «않는» 이유도 같다. 그쪽은 shouldNotFilter 라 AT 검증이 아예
        //    돌지 않아, 잘못된 AT 가 검증 없이 통과한다.
        if (allowsMissingAccessToken(request) && request.getHeader(HEADER_AUTHORIZATION) == null) {
            filterChain.doFilter(request, response);
            return;
        }
        Optional<AccessTokenClaims> claims = verifier.verify(extractToken(request));
        if (claims.isEmpty()) {
            sendUnauthorized(request, response);
            return;
        }

        request.setAttribute(AuthAttributes.CLAIMS, claims.get());
        // 미리보기 계열 핸들러는 «문자열 userId» 속성을 읽는다(1747 부터의 계약). 신원의 출처를 한 곳으로
        // 모으면서 그 계약을 유지한다 — 여기서 심지 않으면 그쪽이 조용히 null 사용자로 동작한다.
        request.setAttribute(AuthAttributes.USER_ID, claims.get().userId().toString());
        filterChain.doFilter(request, response);
    }

    /**
     * AT 없이 지나갈 수 있는 정확한 두 method/path.
     *
     * <p>둘 다 자기 {@code Credentials} 타입이 판정을 소유한다 — 필터와 컨트롤러가 <b>같은</b>
     * 비교를 쓰게 하기 위해서다. 필터가 자기 문자열로 비교하면, 한쪽만 정규화된 경로를 보는 순간
     * 「필터는 열었는데 라우팅은 다른 곳」 또는 그 반대가 된다.
     */
    private static boolean allowsMissingAccessToken(HttpServletRequest request) {
        return LogoutCredentials.matches(request) || LoginAttemptCredentials.matches(request)
                || GuestDeviceCredentials.matches(request);
    }

    private String extractToken(HttpServletRequest request) {
        if (allowsMissingAccessToken(request)) {
            var headers = request.getHeaders(HEADER_AUTHORIZATION);
            if (headers == null || !headers.hasMoreElements()) {
                return null;
            }
            headers.nextElement();
            if (headers.hasMoreElements()) {
                return null;
            }
        }
        String header = request.getHeader(HEADER_AUTHORIZATION);
        if (header == null || header.length() > MAX_AUTHORIZATION_LENGTH || !header.startsWith(BEARER_PREFIX)) {
            return null;
        }
        return header.substring(BEARER_PREFIX.length());
    }

    /** DispatcherServlet 앞의 401도 MVC와 같은 DTO/serializer로 작성한다. */
    private void sendUnauthorized(HttpServletRequest request, HttpServletResponse response) throws IOException {
        responses.writeFilterError(request, response, ApiErrorCode.UNAUTHORIZED,
                CommonErrorCode.UNAUTHORIZED.getMessage());
    }
}

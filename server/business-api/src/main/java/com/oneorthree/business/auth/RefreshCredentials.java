package com.oneorthree.business.auth;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Enumeration;

/**
 * AT 재발급 자격 — <b>RT 하나뿐</b>이다 (GROMO-2035).
 *
 * <h2>AT 를 «읽지 않는다»</h2>
 * {@link LogoutCredentials}·{@link LoginAttemptCredentials} 는 AT 를 선택으로 받고 「보냈다면 유효해야
 * 한다」를 적용한다. 갱신은 <b>그 규칙을 적용할 수 없는 유일한 경로</b>다 — 이 요청이 오는 정상적인
 * 상황이 곧 「AT 가 만료됐다」이기 때문이다. 검증하면 만료 AT 를 실은 요청이 401 이 되고, 앱의 401
 * 처리는 다시 갱신을 부르므로 <b>401 → 갱신 → 401 루프</b>가 된다. 그건 이 티켓이 없애려는
 * 「한 시간마다 로그아웃」과 같은 증상이다.
 *
 * <p>그렇다고 「검증 없이 통과한 AT」가 생기지도 않는다. 이 경로는 {@code Authorization} 헤더를
 * <b>읽지 않고</b>, 주체는 Data 가 RT 서명에서 직접 확인한다 — 읽지 않는 값은 권한이 될 수 없다.
 * 앱이 습관적으로 헤더를 붙이는 클라이언트여도 갱신이 실패하지 않는 것이 덤이고, 그 관용이 자격
 * 축을 넓히지 않는 이유가 이 문단이다.
 */
public record RefreshCredentials(String refreshToken) {

    public static final String PATH = "/auth/sessions/current/refresh";
    public static final String REFRESH_HEADER = "X-Refresh-Token";
    private static final int MAX_CREDENTIAL_LENGTH = 8192;

    /** 필터 예외와 컨트롤러가 공유하는 정확 일치. {@code getRequestURI()} 는 디코딩 전 원문이다. */
    public static boolean matches(HttpServletRequest request) {
        return "POST".equals(request.getMethod()) && PATH.equals(request.getRequestURI());
    }

    public static RefreshCredentials from(HttpServletRequest request) {
        // Authorization 은 읽지 않는다(위 javadoc). 만료된 AT 가 실려 있는 것이 이 경로의 «정상» 이다.
        return new RefreshCredentials(refreshToken(request));
    }

    /**
     * 헤더가 <b>정확히 하나</b>여야 한다 ({@link LogoutCredentials} 와 같은 규율).
     *
     * <p>둘을 허용하면 프록시 단계마다 다른 값을 고를 수 있고, 그러면 「어느 세션의 갱신인가」가
     * 경유 경로에 따라 갈린다.
     */
    private static String refreshToken(HttpServletRequest request) {
        Enumeration<String> values = request.getHeaders(REFRESH_HEADER);
        if (values == null || !values.hasMoreElements()) {
            throw new PublicApiException(ApiErrorCode.REFRESH_TOKEN, null);
        }
        String value = values.nextElement();
        if (values.hasMoreElements() || value == null || value.isBlank()
                || value.length() > MAX_CREDENTIAL_LENGTH || !value.equals(value.strip())
                || value.contains(",")) {
            throw new PublicApiException(ApiErrorCode.REFRESH_TOKEN, null);
        }
        return value;
    }

    /** RT 원문이 로그·오류 덤프로 새지 않게 한다 (계정 LLD §2.1 「헤더도 자격이다」). */
    @Override
    public String toString() {
        return "RefreshCredentials[redacted]";
    }
}

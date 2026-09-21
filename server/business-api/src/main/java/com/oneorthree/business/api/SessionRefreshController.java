package com.oneorthree.business.api;

import com.oneorthree.business.auth.RefreshCredentials;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.SessionRefreshUseCase;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

/**
 * 공개 AT 재발급 — {@code POST /auth/sessions/current/refresh} (GROMO-2035).
 *
 * <p>경로를 {@code /auth/sessions/**} <b>아래</b>에 둔 것은 의도다. {@code PublicApiRoutes.ROOTS} 와
 * nginx 위성 include 의 Business 분기가 이미 그 접두어를 잡고 있어, 봉투({@code {"data": …}})와
 * {@code Cache-Control: no-store}(계정 LLD §1 「토큰 응답은 no-store」)가 <b>설정 변경 없이</b> 붙는다.
 * 새 최상위 접두어를 만들면 두 곳을 같이 늘려야 하고, 한쪽을 잊으면 dev·prod 에서만 404 가 난다.
 *
 * <p>{@link SessionLogoutController} 와 같이 필터 예외와 <b>같은</b> raw method/path 를 재확인한다 —
 * 인코딩 변형으로 필터의 정확 일치는 비껴가고 MVC 라우팅에는 걸리는 경로가 있으면 여기서 끊는다.
 */
@RestController
@RequiredArgsConstructor
public class SessionRefreshController {

    private final SessionRefreshUseCase sessions;
    private final UpstreamConfigProperties properties;

    @PostMapping(RefreshCredentials.PATH)
    public SessionRefreshUseCase.Result refresh(HttpServletRequest request) throws IOException {
        // 본문·쿼리를 받지 않는다. 자격은 헤더 하나뿐이라, 본문을 허용하면 「무엇이 계약인가」가
        // 두 곳으로 갈린다(SessionLogoutController 와 같은 판단).
        if (!RefreshCredentials.matches(request) || request.getQueryString() != null
                || request.getContentLengthLong() > 0 || request.getInputStream().read() != -1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        RefreshCredentials credentials = RefreshCredentials.from(request);
        return sessions.refresh(credentials.refreshToken(),
                Deadline.startingNow(properties.getComposition().getDeadline()));
    }
}

package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import com.oneorthree.business.usecase.IslandScreenUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Set;

/**
 * 섬 장소 화면 조회 3종의 공개 표면 (GROMO-1897) — {@code GET /screens/home} · {@code /screens/focus} ·
 * {@code /screens/town-hall}.
 *
 * <p>{@code /screens/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투·{@code no-store} 가 자동으로 붙는다.
 * query 검증만 하고 유스케이스에 넘긴다. 화면 조회는 cursor 를 받지 않는다(B10) — 허용 목록 밖의 키나
 * 같은 키 반복은 400 이다(LLD §1).
 */
@RestController
@RequiredArgsConstructor
public class IslandScreenController {

    private static final Set<String> HOME_QUERY = Set.of("date", "timezone");

    private final IslandScreenUseCase screens;
    private final SettingsSessionGuard sessions;

    @GetMapping("/screens/home")
    public Map<String, Object> home(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        onlyQuery(request, HOME_QUERY);
        return screens.home(claims, requestId(request), request.getParameter("date"),
                request.getParameter("timezone"));
    }

    @GetMapping("/screens/focus")
    public Map<String, Object> focus(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        onlyQuery(request, Set.of());
        return screens.focus(claims, requestId(request));
    }

    @GetMapping("/screens/town-hall")
    public Map<String, Object> townHall(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        onlyQuery(request, Set.of());
        return screens.townHall(claims, requestId(request));
    }

    /** 모르는 키는 이름을 되돌려주지 않는다(field null) — 요청 문자열을 오류 본문에 반사하지 않는다. */
    private static void onlyQuery(HttpServletRequest request, Set<String> allowed) {
        for (Map.Entry<String, String[]> entry : request.getParameterMap().entrySet()) {
            if (!allowed.contains(entry.getKey())) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, null);
            }
            if (entry.getValue().length != 1) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, entry.getKey());
            }
        }
    }

    private static String requestId(HttpServletRequest request) {
        return (String) request.getAttribute(RequestEnvelopeFilter.REQUEST_ID);
    }
}

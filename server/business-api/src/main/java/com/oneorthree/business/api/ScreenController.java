package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import com.oneorthree.business.usecase.ScreenReadUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 화면 조회 {@code GET /screens/*} (GROMO-1896·1897·1899, bff-screens B15·B24~B26). query 검증만 하고 유스케이스에 넘긴다.
 *
 * <p>{@code /screens/**} 는 {@code PublicApiRoutes} 에 있어 {@code {data}} 봉투가, {@code RequestEnvelopeFilter}
 * 가 {@code Cache-Control: no-store}(B11)를 붙인다. 주체는 서명된 세션에서만 온다. 허용하지 않은 query 와
 * 중복 query 는 400 {@code INVALID_PARAMETER} 다(LLD §1) — cursor·limit 은 받지 않는다(B10).
 */
@RestController
@RequiredArgsConstructor
public class ScreenController {

    private final ScreenReadUseCase screens;
    private final SettingsSessionGuard sessions;

    @GetMapping("/screens/launch")
    public Map<String, Object> launch(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.launch(claims, requestId(request));
    }

    @GetMapping("/screens/raft")
    public Map<String, Object> raft(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.raft(claims, requestId(request));
    }

    @GetMapping("/screens/account")
    public Map<String, Object> account(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.account(claims, requestId(request));
    }

    @GetMapping("/screens/explore")
    public Map<String, Object> explore(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of("q"));
        String[] q = request.getParameterValues("q");
        return screens.explore(claims, q == null ? null : q[0], requestId(request));
    }

    @GetMapping("/screens/visit/{islandId}")
    public Map<String, Object> visit(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.visit(claims, uuid(islandId), requestId(request));
    }

    /** {@code home} — 오늘 집중 요약의 {@code date}·{@code timezone} 만 받아 도메인에 그대로 넘긴다(GROMO-1897). */
    @GetMapping("/screens/home")
    public Map<String, Object> home(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of("date", "timezone"));
        return screens.home(claims, request.getParameter("date"), request.getParameter("timezone"),
                requestId(request));
    }

    @GetMapping("/screens/focus")
    public Map<String, Object> focus(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.focus(claims, requestId(request));
    }

    @GetMapping("/screens/town-hall")
    public Map<String, Object> townHall(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.townHall(claims, requestId(request));
    }

    @GetMapping("/screens/mailbox")
    public Map<String, Object> mailbox(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of());
        return screens.mailbox(claims, requestId(request));
    }

    /** {@code friends} — 친구 당일 집중 분의 기준일 {@code date} 만 받아 도메인에 그대로 넘긴다(GROMO-1899). */
    @GetMapping("/screens/friends")
    public Map<String, Object> friends(HttpServletRequest request) {
        AccessTokenClaims claims = begin(request, Set.of("date"));
        return screens.friends(claims, request.getParameter("date"), requestId(request));
    }

    /** 세션을 먼저 확인한다 — 미인증 요청에 query 오류를 먼저 알려 주지 않는다. */
    private AccessTokenClaims begin(HttpServletRequest request, Set<String> allowed) {
        AccessTokenClaims claims = sessions.requireSession(request);
        request.getParameterMap().forEach((name, values) -> {
            if (!allowed.contains(name) || values.length != 1) {
                throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
            }
        });
        return claims;
    }

    private static String requestId(HttpServletRequest request) {
        return (String) request.getAttribute(RequestEnvelopeFilter.REQUEST_ID);
    }

    private static UUID uuid(String value) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "islandId");
        }
    }
}

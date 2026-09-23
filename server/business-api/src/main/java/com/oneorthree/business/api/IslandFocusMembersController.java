package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandFocusMembersUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 같이 낚시 초기 스냅샷 2종의 공개 표면 (GROMO-1765, focus-rest-session LLD §2 focus-group · rest-members).
 *
 * <p>{@code /islands/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투는 자동으로 씌워진다. 주체는 strict
 * 세션에서만 오고 {@code onBehalfOf} 로 상류에 실려 Data 가 활성 주민인지 다시 판정한다(비주민 403).
 * 실시간 구독(STOMP)·emote 는 이 클래스 범위가 아니다 — 이 GET 은 구독 뒤 병합 기준이 되는 스냅샷이다.
 */
@RestController
@RequiredArgsConstructor
public class IslandFocusMembersController {

    private final IslandFocusMembersUseCase members;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/islands/{islandId}/focus-members")
    public IslandFocusMembersUseCase.FocusMembersView focusMembers(@PathVariable String islandId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return members.focusMembers(claims, uuid(islandId), deadline());
    }

    @GetMapping("/islands/{islandId}/rest-members")
    public IslandFocusMembersUseCase.RestMembersView restMembers(@PathVariable String islandId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return members.restMembers(claims, uuid(islandId), deadline());
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

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.AccountMe;
import com.oneorthree.business.upstream.data.dto.AccountProfile;
import com.oneorthree.business.usecase.AccountUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Set;
import java.util.UUID;

/**
 * 공개 계정 3종 {@code GET|PATCH|DELETE /me} (GROMO-1801 · 계정 LLD §2.2·§2.3·§2.5).
 *
 * <p>{@code /me/**} 는 {@code PublicApiRoutes} 에 있어 {@code {data}} 봉투가 자동이다. 주체는 strict 세션
 * (서명된 sid·gen)에서만 오고, PATCH·DELETE 는 {@code Idempotency-Key}(UUID36)가 필수다. 본문의 생략은
 * 미변경, 명시 null·빈 객체·미지 필드는 400 이다(LLD §1).
 */
@RestController
@RequiredArgsConstructor
public class AccountController {

    private static final Set<String> PATCH_FIELDS = Set.of("name", "catColor");
    private static final String CONFIRMATION = "DELETE";

    private final AccountUseCase account;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/me")
    public AccountMe me(HttpServletRequest request) {
        return account.me(sessions.requireSession(request), deadline());
    }

    /**
     * 이름 변경. catColor 는 Q03 카탈로그가 없어 어떤 문자열도 허용 ID 가 아니다 — 해석은 되지만 미지원인 값이라
     * 422 {@code OUT_OF_RANGE} 이고, 이름과 함께 와도 부분 성공 없이 전체를 거절한다.
     */
    @PatchMapping(value = "/me", consumes = "application/json")
    public AccountProfile patch(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.isEmpty()
                || !PATCH_FIELDS.containsAll(body.propertyNames())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode catColor = body.get("catColor");
        if (catColor != null) {
            throw catColor.isString()
                    ? new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "catColor")
                    : new PublicApiException(ApiErrorCode.INVALID_REQUEST, "catColor");
        }
        // 여기까지 오면 본문은 name 하나다. 명시 null·문자열 외 타입은 400 이다.
        JsonNode name = body.get("name");
        if (name == null || !name.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "name");
        }
        return account.rename(claims, name.stringValue(), key, deadline());
    }

    /** 탈퇴. {@code confirmation} 은 재인증이 아니라 오조작 방지이며 대소문자까지 정확히 {@code "DELETE"} 다. */
    @DeleteMapping(value = "/me", consumes = "application/json")
    public AccountUseCase.Deleted withdraw(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        CommandKeys.required(request);
        JsonNode confirmation = body == null ? null : body.get("confirmation");
        if (body == null || !body.isObject() || body.size() != 1 || confirmation == null || !confirmation.isString()
                || !CONFIRMATION.equals(confirmation.stringValue())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "confirmation");
        }
        return account.withdraw(claims, deadline());
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

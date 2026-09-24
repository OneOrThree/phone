package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.config.UpstreamConfigProperties;
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

    private static final Set<String> PATCH_FIELDS = Set.of("name", "catColor", "mainIslandId");
    /**
     * 고양이 색 카탈로그 — 계정 Q03(2026-09-19). Data {@code CatColors}·{@code users.cat_color} CHECK(V80)와 같은 6종이다.
     * 공개 오류의 {@code field} 를 싣기 위해 여기서 먼저 거른다(상류 오류 중계는 field 를 옮기지 않는다).
     */
    private static final Set<String> CAT_COLORS = Set.of("black", "ginger", "cream", "gray", "white", "calico");
    private static final String CONFIRMATION = "DELETE";

    private final AccountUseCase account;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/me")
    public AccountUseCase.AccountView me(HttpServletRequest request) {
        return account.me(sessions.requireSession(request), properties.deadline());
    }

    /**
     * 이름·고양이 색·메인 섬 변경. 셋 중 하나 이상 필수이고 생략한 필드는 보존한다. 카탈로그 밖 색은 해석은 되지만
     * 미지원인 값이라 422 {@code OUT_OF_RANGE} 이고, 이름과 함께 와도 부분 성공 없이 전체를 거절한다.
     *
     * <p>{@code mainIslandId} 는 여기서 <b>형식만</b> 본다(GROMO-1971) — 「그 섬의 주민인가」는 Data 가 잠금
     * 아래에서 판정해 403 으로 되돌리고, 이 클래스가 섬 목록을 따로 들고 있으면 그것이 곧 두 번째 진실이 된다.
     */
    @PatchMapping(value = "/me", consumes = "application/json")
    public AccountUseCase.ProfileView patch(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.isEmpty()
                || !PATCH_FIELDS.containsAll(body.propertyNames())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        // 명시 null·문자열 외 타입은 400 이다.
        JsonNode name = body.get("name");
        if (name != null && !name.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "name");
        }
        JsonNode catColor = body.get("catColor");
        if (catColor != null && !catColor.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "catColor");
        }
        if (catColor != null && !CAT_COLORS.contains(catColor.stringValue())) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "catColor");
        }
        JsonNode mainIslandId = body.get("mainIslandId");
        if (mainIslandId != null && !mainIslandId.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "mainIslandId");
        }
        return account.updateProfile(claims, name == null ? null : name.stringValue(),
                catColor == null ? null : catColor.stringValue(),
                mainIslandId == null ? null : islandId(mainIslandId.stringValue()), key, properties.deadline());
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
        return account.withdraw(claims, properties.deadline());
    }

    /**
     * UUID 가 아닌 문자열은 해석 자체가 안 되므로 400 이다 — 「없는 섬」(Data 의 403)과 층이 다르다.
     *
     * <p><b>{@code UUID.fromString} 만으로는 모자라다</b> — {@code "1-2-3-4-5"} 같은 축약 문자열을 받아
     * <b>패딩된 다른 UUID</b> 로 만들어 준다. 그대로 상류로 넘기면 형식 오류가 400 이 아니라 「그 섬의
     * 주민이 아니다」 403 으로 둔갑해, 앱은 고칠 수 없는 입력을 권한 문제로 읽는다. 그래서 다른 공개
     * UUID 파서와 같은 규칙으로 36자 길이와 {@code toString()} 왕복 일치까지 본다.
     */
    private static UUID islandId(String raw) {
        try {
            UUID parsed = UUID.fromString(raw);
            if (raw.length() != 36 || !parsed.toString().equalsIgnoreCase(raw)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "mainIslandId");
        }
    }
}

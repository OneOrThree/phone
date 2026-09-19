package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.IslandAppearanceState;
import com.oneorthree.business.upstream.data.dto.PersonalAppearanceState;
import com.oneorthree.business.upstream.data.dto.PersonalInventory;
import com.oneorthree.business.upstream.data.dto.SharedInventory;
import com.oneorthree.business.usecase.AppearanceUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 보유품·외양 4종의 공개 표면 (GROMO-1783, island-appearance LLD §3~§4).
 *
 * <p>{@code /me/**}·{@code /islands/**} 는 {@code PublicApiRoutes.ROOTS} 에 이미 있어 봉투는
 * 자동으로 씌워진다. PATCH 는 {@code Idempotency-Key}(UUID36)가 필수이고 주체는 <b>strict
 * 세션</b>에서만 온다 — 소유권·권한·버전 비교는 전부 Data TX 가 한다(LLD §2).
 *
 * <p>PATCH 본문은 tri-state 다 — 필드 부재(유지)·명시 null(해제 또는 거절)·값(적용)을
 * 구분해야 하므로, 여기서는 허용 필드와 값 타입만 검사하고 제출된 필드를 그대로 fields+values
 * 캐리어로 옮긴다. null 슬롯의 허용 여부는 Data 가 판정한다(422).
 */
@RestController
@RequiredArgsConstructor
public class AppearanceController {

    /** 개인 PATCH 에 허용되는 필드 — 그 외 키는 다른 의미 객체라 400 이다. */
    private static final Set<String> PERSONAL_FIELDS = Set.of("clothes", "decor", "hull", "position");
    /** 공동 PATCH 의 외양 필드 — expectedVersion 은 외양 필드가 아니라 별도 계약이다. */
    private static final Set<String> ISLAND_FIELDS = Set.of("islandThemeId", "buildingThemes");

    private final AppearanceUseCase appearance;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 개인 인벤토리 (LLD §3 GET) — 본인 소유 목록과 현재 외양을 한 스냅샷으로 돌려준다. */
    @GetMapping("/me/inventory")
    public PersonalInventory myInventory(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return appearance.myInventory(claims, deadline());
    }

    /** 개인 외양 적용 (LLD §4 PATCH) — 미제출 필드 유지·null 해제·값 적용. */
    @PatchMapping(value = "/me/appearance", consumes = "application/json")
    public PersonalAppearanceState patchMine(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        PatchCarrier carrier = carrier(body, PERSONAL_FIELDS);
        return appearance.patchMine(claims, carrier.fields(), carrier.values(), key, deadline());
    }

    /** 공동 인벤토리 (LLD §3 GET) — 활성 주민만 본다. */
    @GetMapping("/islands/{islandId}/inventory")
    public SharedInventory islandInventory(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return appearance.islandInventory(claims, uuid(islandId), deadline());
    }

    /** 공동 외양 적용 (LLD §4 PATCH) — 방장 전용·expectedVersion 낙관 검사. */
    @PatchMapping(value = "/islands/{islandId}/appearance", consumes = "application/json")
    public IslandAppearanceState patchIsland(@PathVariable String islandId,
            @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        PatchCarrier carrier = carrier(body, ISLAND_FIELDS, Set.of("expectedVersion"));
        return appearance.patchIsland(claims, uuid(islandId), carrier.fields(), carrier.values(),
                ResourceVersions.fromJson(body.get("expectedVersion"), "expectedVersion"),
                key, deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    /**
     * tri-state 캐리어 복원 — 제출된 필드만 {@code fields}·{@code values} 에 담고, 명시 null 은
     * 맵 키로 보존한다. 허용 외 키·비문자열 스칼라·비객체 buildingThemes·비문자열 건물 값은 400.
     */
    private static PatchCarrier carrier(JsonNode body, Set<String> allowed) {
        return carrier(body, allowed, Set.of());
    }

    private static PatchCarrier carrier(JsonNode body, Set<String> allowed, Set<String> extra) {
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        List<String> fields = new ArrayList<>();
        Map<String, Object> values = new LinkedHashMap<>();
        for (String name : body.propertyNames()) {
            if (extra.contains(name)) {
                continue;
            }
            if (!allowed.contains(name)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
            fields.add(name);
            values.put(name, value(name, body.get(name)));
        }
        if (fields.isEmpty()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        return new PatchCarrier(fields, values);
    }

    /** 스칼라 슬롯은 문자열·null 만 허용, buildingThemes 는 문자열|null 값의 객체만 허용한다. */
    private static Object value(String name, JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if ("buildingThemes".equals(name)) {
            if (!node.isObject()) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
            Map<String, Object> themes = new LinkedHashMap<>();
            for (String building : node.propertyNames()) {
                JsonNode theme = node.get(building);
                if (theme == null || theme.isNull()) {
                    themes.put(building, null);
                } else if (theme.isString()) {
                    themes.put(building, theme.stringValue());
                } else {
                    throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
                }
            }
            return themes;
        }
        if (!node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
        }
        return node.stringValue();
    }

    private record PatchCarrier(List<String> fields, Map<String, Object> values) {
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

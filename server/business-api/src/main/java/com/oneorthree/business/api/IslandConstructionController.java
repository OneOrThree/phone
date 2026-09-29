package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.ConstructionResponses.ConstructionOptionsView;
import com.oneorthree.business.api.dto.ConstructionResponses.ConstructionResultView;
import com.oneorthree.business.api.dto.ConstructionResponses.ConstructionTargetView;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandConstructionUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/**
 * 섬 건설 3종의 공개 표면 (GROMO-1767, island-construction LLD §2~§3).
 *
 * <p>{@code /islands/**} 는 {@code PublicApiRoutes.ROOTS} 에 이미 있어 봉투는 자동으로 씌워진다.
 * PUT/POST 는 {@code Idempotency-Key}(UUID36)가 필수이고 주체는 <b>strict 세션</b>에서만 온다 —
 * 앱이 보낸 {@code X-User-Id}·잔액·가격 입력은 받지 않고, 검증한 주체만 {@code onBehalfOf} 로
 * 상류에 실려 Data TX 가 현재 사용자·소속·섬 종료 상태를 다시 검사한다(LLD §2).
 */
@RestController
@RequiredArgsConstructor
public class IslandConstructionController {

    /** 서버 시설 식별자의 상한 — 짧은 slug 만 등록되므로 그 이상은 422 로 돌려보낸다. */
    private static final int BUILDING_ID_MAX = 40;

    private final IslandConstructionUseCase construction;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /**
     * 건설 옵션 스냅샷 (LLD §2 GET). 변경 권한이 없는 주민도 조회는 된다 — 실행 권한은 항목별
     * {@code selectable}/{@code blockedReason} 에 담기지 GET 전체를 403 으로 거절하지 않는다.
     */
    @GetMapping("/islands/{islandId}/construction-options")
    public ConstructionOptionsView options(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return construction.options(claims, PublicIds.uuid(islandId, "islandId"), properties.deadline());
    }

    /**
     * 건설 목표 선택 (LLD §2 PUT). 차감이 없으므로 costPolicyVersion·잔액을 받지 않고, 같은
     * 목표·현재 version 은 무변경 200 이다(C11).
     */
    @PutMapping(value = "/islands/{islandId}/construction-target", consumes = "application/json")
    public ConstructionTargetView target(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 2) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        return construction.selectTarget(claims, PublicIds.uuid(islandId, "islandId"), buildingId(body),
                ResourceVersions.fromJson(body.get("expectedVersion"), "expectedVersion"),
                key, properties.deadline());
    }

    /**
     * 건설 명령 (LLD §2 POST). 가격 revision 축이 섬 version 과 독립이라 expectedCostPolicyVersion
     * 도 필수다 — 둘 다 지문에 들어가 같은 키의 다른 본문은 재사용 거절이 된다(C10·§3).
     */
    @PostMapping(value = "/islands/{islandId}/constructions", consumes = "application/json")
    public ConstructionResultView build(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 3) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        return construction.build(claims, PublicIds.uuid(islandId, "islandId"), buildingId(body),
                ResourceVersions.fromJson(body.get("expectedVersion"), "expectedVersion"),
                ResourceVersions.fromJson(body.get("expectedCostPolicyVersion"),
                        "expectedCostPolicyVersion"),
                key, properties.deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    /**
     * 시설 식별자 — 문자열이 아니거나 없으면 400, 빈 문자열은 422 다(LLD §2).
     * 등록된 id 인지는 Data 가 TX 안에서 판정한다(미지원 id → 422).
     */
    private static String buildingId(JsonNode body) {
        JsonNode node = body.get("buildingId");
        if (node == null || !node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "buildingId");
        }
        String value = node.stringValue();
        if (value.isBlank() || value.length() > BUILDING_ID_MAX) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "buildingId");
        }
        return value;
    }
}

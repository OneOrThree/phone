package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.IslandManagementUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 섬 관리·주민 잔여 6종의 공개 경계 (GROMO-1802, 섬 관리 LLD §3) — 정보 수정·주민 목록·신청자 목록·
 * 가입 요청 처리·강퇴·나가기.
 *
 * <p>여기서 하는 것은 입력의 «모양» 검증뿐이다. 권한(현재 방장·활성 주민)·상태·잠금은 Data 가 판정하고
 * {@link IslandManagementUseCase} 가 코드만 옮긴다. 주체는 서명된 AT 에서만 오고, 명령 4종은
 * {@code Idempotency-Key} 가 필수다. 경로는 nginx 의 기존 {@code islands} 분기가 그대로 전달한다.
 */
@RestController
@RequiredArgsConstructor
public class IslandManagementController {

    private static final int NAME_MAX = 50;
    private static final int INTRO_MAX = 200;
    /** 정원 범위 — 정책 「정원은 1~15명」(GROMO-1993). 현원 하한은 Data 가 본다. */
    private static final int MEMBERS_MIN = 1;
    private static final int MEMBERS_MAX = 15;
    private static final Set<String> MANAGE_KEYS =
            Set.of("name", "intro", "approvalRequired", "maxMembers");

    private final IslandManagementUseCase management;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /**
     * 섬 정보 수정 (LLD §2·§3.1). 키가 없으면 미변경, 명시 null 은 400, 빈 이름·길이 초과는 422 다.
     * 계약 밖 키(password·isPrivate 등)는 400 으로 거절한다. 빈 객체는 no-op 성공이다.
     * {@code maxMembers}(1~15)는 GROMO-1993 에서 열었다 — 현원보다 작게 줄이면 Data 가 400 으로 거절한다.
     */
    @PatchMapping(value = "/islands/{islandId}", consumes = "application/json")
    public IslandManagementUseCase.ManagedIslandView manage(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = uuid(islandId, "islandId");
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        for (String field : body.propertyNames()) {
            if (!MANAGE_KEYS.contains(field)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
            }
        }
        if (body.has("name")) {
            String name = text(body, "name", NAME_MAX);
            if (name.isBlank()) {
                throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "name");
            }
            fields.put("name", name);
        }
        if (body.has("intro")) {
            fields.put("intro", text(body, "intro", INTRO_MAX));
        }
        if (body.has("approvalRequired")) {
            if (!body.get("approvalRequired").isBoolean()) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "approvalRequired");
            }
            fields.put("approvalRequired", body.get("approvalRequired").booleanValue());
        }
        if (body.has("maxMembers")) {
            JsonNode node = body.get("maxMembers");
            // canConvertToInt 가 «먼저» 다 — 4294967297 같은 32비트 초과 정수는 isIntegralNumber 가 참이고
            // intValue() 가 1 로 잘려, 범위 검사를 통과한 채 정원이 1 로 저장된다(IslandQuestController#integer
            // 와 같은 순서). 자르기 전에 원래 값이 int 에 들어가는지부터 본다.
            if (!node.isIntegralNumber() || !node.canConvertToInt()
                    || node.intValue() < MEMBERS_MIN || node.intValue() > MEMBERS_MAX) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "maxMembers");
            }
            fields.put("maxMembers", node.intValue());
        }
        return management.manage(claims, island, fields, key, deadline());
    }

    /** 주민 목록 (LLD §3.2). 기본 30, 1~100 경계는 {@code CursorScope} 가 422 로 강제한다. */
    @GetMapping("/islands/{islandId}/members")
    public IslandManagementUseCase.MembersPage members(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return management.members(claims, uuid(islandId, "islandId"), single(request, "cursor"),
                limit(request), deadline());
    }

    /** 신청자 목록 (LLD §3.3) — 방장 전용, pending 만. */
    @GetMapping("/islands/{islandId}/join-requests")
    public IslandManagementUseCase.JoinRequestsPage joinRequests(@PathVariable String islandId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return management.joinRequests(claims, uuid(islandId, "islandId"), single(request, "cursor"),
                limit(request), deadline());
    }

    /** 가입 요청 승인·거절 (LLD §3.4). 본문은 정확히 {@code {decision: approve|reject}}. */
    @PatchMapping(value = "/islands/{islandId}/join-requests/{requestId}", consumes = "application/json")
    public IslandManagementUseCase.JoinRequestAnswerView answer(@PathVariable String islandId,
            @PathVariable String requestId, @RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        UUID island = uuid(islandId, "islandId");
        UUID joinRequest = uuid(requestId, "requestId");
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode decision = body.get("decision");
        if (decision == null || !decision.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "decision");
        }
        if (!"approve".equals(decision.stringValue()) && !"reject".equals(decision.stringValue())) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "decision");
        }
        return management.answer(claims, island, joinRequest, "approve".equals(decision.stringValue()), key,
                deadline());
    }

    /** 주민 강퇴 (LLD §3.6). 본문 없음. */
    @DeleteMapping("/islands/{islandId}/members/{userId}")
    public IslandManagementUseCase.Removed kick(@PathVariable String islandId, @PathVariable String userId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return management.kick(claims, uuid(islandId, "islandId"), uuid(userId, "userId"), key, deadline());
    }

    /** 본인 나가기 (LLD §3.7). 본문 없음. */
    @DeleteMapping("/islands/{islandId}/memberships/me")
    public IslandManagementUseCase.Left leave(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return management.leave(claims, uuid(islandId, "islandId"), key, deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    /** 선택 문자열 필드의 값 — 명시 null·비문자열은 400, 길이 초과는 422 다(LLD §2). */
    private static String text(JsonNode body, String field, int max) {
        JsonNode node = body.get(field);
        if (!node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        if (node.stringValue().length() > max) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return node.stringValue();
    }

    private static UUID uuid(String value, String field) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, field);
        }
    }

    /** 쿼리 파라미터 하나 — 같은 키가 여러 번 오면 400 이다. */
    private static String single(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null || values.length == 0) {
            return null;
        }
        if (values.length > 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return values[0];
    }

    private static int limit(HttpServletRequest request) {
        String raw = single(request, "limit");
        if (raw == null) {
            return IslandManagementUseCase.DEFAULT_LIMIT;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}

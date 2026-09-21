package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.IslandPage;
import com.oneorthree.business.api.dto.MyIslandsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.CurrentIsland;
import com.oneorthree.business.upstream.data.dto.InvitationResolved;
import com.oneorthree.business.upstream.data.dto.IslandCreated;
import com.oneorthree.business.upstream.data.dto.IslandInvitationIssued;
import com.oneorthree.business.upstream.data.dto.JoinIslandResult;
import com.oneorthree.business.upstream.data.dto.JoinRequestCancel;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.usecase.IslandMembershipUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Set;
import java.util.UUID;

/**
 * 섬 생성·조회·탐색·현재 섬 이동 6종의 공개 표면 (GROMO-1759).
 *
 * <p>경로에 {@code /v1}·{@code /api} 를 붙이지 않는다 — 접두어 없는 신규 경로가 Business 몫이라는
 * api-platform 규칙이고, nginx 가 {@code /islands}·{@code /me} 를 이 upstream 으로 보낸다.
 * {@code PublicApiRoutes.ROOTS} 에 두 뿌리가 이미 있어 봉투는 자동으로 씌워진다.
 *
 * <p>주체는 <b>언제나 서명된 세션</b> 에서 온다. 앱이 보낸 {@code X-User-Id} 같은 헤더는 읽지 않고
 * 상류로도 전달되지 않는다 — {@code InternalCall} 이 그 헤더를 직접 넣는 것을 금지하고
 * {@code InternalHttpClient} 가 검증된 주체로 덮어쓴다. LLD §3.4 의 "헤더/쿼리로 범위를 고를 수
 * 없다"가 여기서 구조적으로 보장된다.
 */
@RestController
@RequiredArgsConstructor
public class IslandMembershipController {

    private static final int NAME_MAX = 50;
    private static final int INTRO_MAX = 200;
    private static final int SEARCH_LIMIT_DEFAULT = 20;
    private static final int DISCOVER_LIMIT_DEFAULT = 1;
    // 초대 code·token 크기는 내부 계약(InvitationResolveCommandRequest·JoinIslandCommandRequest)과
    // 같게 둔다 — 여기서 더 느슨하게 받으면 초과분이 400/422 로 갈리는 경계가 상류와 어긋난다.
    private static final int CODE_MAX = 32;
    private static final int TOKEN_MAX = 64;
    /** 섬 생성 본문의 화이트리스트 — password 는 없다(LLD §1). maxMembers 는 GROMO-1993 에서 열었다. */
    private static final Set<String> CREATE_KEYS = Set.of("name", "intro", "approvalRequired", "maxMembers");
    /**
     * 정원 범위 — 정책 「정원은 1~15명」(GROMO-1993). 길이 상한과 같은 «모양» 판정이라 Business 가
     * 네트워크 전에 먼저 거른다. Data 의 {@code @Min}/{@code @Max} 가 여전히 최종 경계다.
     */
    private static final int MEMBERS_MIN = 1;
    private static final int MEMBERS_MAX = 15;

    private final IslandMembershipUseCase islands;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 섬 생성 (LLD §3.1). */
    @PostMapping(value = "/islands", consumes = "application/json")
    public ResponseEntity<IslandCreated> create(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        // intro·maxMembers 는 선택이다. 화이트리스트 밖 키가 섞이면 거절한다 — password 를 client 가
        // 주입하지 못하게 하는 것이 계약이다(LLD §1). maxMembers 는 정책 「방장이 정원을 설정한다」로
        // 열렸다(GROMO-1993) — 범위(1~15) 판정은 Data 의 검증이 정본이라 여기서는 정수 모양만 본다.
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        for (String field : body.propertyNames()) {
            if (!CREATE_KEYS.contains(field)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
            }
        }
        String name = requiredText(body, "name", NAME_MAX);
        String intro = body.has("intro") ? optionalText(body, "intro", INTRO_MAX) : null;
        JsonNode approvalRequired = body.get("approvalRequired");
        if (approvalRequired == null || !approvalRequired.isBoolean()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "approvalRequired");
        }
        Integer maxMembers = null;
        if (body.has("maxMembers")) {
            JsonNode node = body.get("maxMembers");
            // canConvertToInt 가 «먼저» 다 — 32비트를 넘는 JSON 정수(4294967297)는 isIntegralNumber 가
            // 참인데 intValue() 가 1 로 잘려 범위 검사를 통과한다. 수정 경로
            // ({@code IslandManagementController#manage})에도 같은 판정이 있다.
            if (!node.isIntegralNumber() || !node.canConvertToInt()
                    || node.intValue() < MEMBERS_MIN || node.intValue() > MEMBERS_MAX) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "maxMembers");
            }
            maxMembers = node.intValue();
        }
        IslandCreated created = islands.create(claims, name, intro, approvalRequired.booleanValue(),
                maxMembers, key, deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /** 이름 검색 (LLD §3.2). 현재 섬 전망대가 필요하다. */
    @GetMapping("/islands")
    public IslandPage islands(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return islands.search(claims, single(request, "q"), single(request, "cursor"),
                limit(request, SEARCH_LIMIT_DEFAULT), deadline());
    }

    /**
     * 첫 소속 탐색 (LLD §3.3). 전망대 가드가 <b>없다</b>.
     *
     * <p>{@code /islands/discover} 는 {@code /islands/{islandId}} 보다 구체적인 경로라 Spring 이 먼저
     * 고른다 — 리터럴 세그먼트가 경로 변수를 이긴다.
     */
    @GetMapping("/islands/discover")
    public IslandPage discover(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return islands.discover(claims, single(request, "cursor"),
                limit(request, DISCOVER_LIMIT_DEFAULT), deadline());
    }

    /** 섬 하나 (LLD §3.4). 주민이면 상세, 비소속이면 공개 요약이다. */
    @GetMapping("/islands/{islandId}")
    public Object island(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return islands.island(claims, uuid(islandId, "islandId"), deadline());
    }

    /** 내 섬 목록 (LLD §3.5). */
    @GetMapping("/me/islands")
    public MyIslandsResponse myIslands(HttpServletRequest request) {
        return islands.myIslands(sessions.requireSession(request), deadline());
    }

    /** 현재 섬 이동 (LLD §3.6). */
    @PutMapping(value = "/me/current-island", consumes = "application/json")
    public CurrentIsland switchCurrentIsland(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode islandId = body.get("islandId");
        if (islandId == null || !islandId.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "islandId");
        }
        return islands.switchCurrentIsland(claims, uuid(islandId.stringValue(), "islandId"), key,
                deadline());
    }

    /**
     * 섬 가입 (GROMO-1760, LLD §3.7).
     *
     * <p>본문은 선택이다 — 없음·빈 객체·{@code {invitationToken}} 셋만 받고 그 밖의 키는 거절한다.
     * 즉시 가입이면 {@code active}+새 current, 승인제면 {@code pending} 이다.
     */
    @PostMapping("/islands/{islandId}/memberships")
    public JoinIslandResult join(@PathVariable String islandId,
            @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        String invitationToken = null;
        if (body != null && !body.isNull()) {
            if (!body.isObject() || body.size() > 1
                    || (body.size() == 1 && !body.has("invitationToken"))) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
            }
            invitationToken = optionalText(body, "invitationToken", TOKEN_MAX);
        }
        return islands.join(claims, uuid(islandId, "islandId"), invitationToken, key, deadline());
    }

    /** 가입 요청 상태 (GROMO-1760, LLD §3.8). 남의 요청은 상류가 404 로 접는다. */
    @GetMapping("/me/join-requests/{requestId}")
    public JoinRequestStatus joinRequest(@PathVariable String requestId, HttpServletRequest request) {
        return islands.joinRequest(sessions.requireSession(request),
                uuid(requestId, "requestId"), deadline());
    }

    /** 가입 요청 취소 (GROMO-1760, LLD §3.9). 본인의 pending 만 종결된다. */
    @DeleteMapping("/me/join-requests/{requestId}")
    public JoinRequestCancel cancelJoinRequest(@PathVariable String requestId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return islands.cancelJoinRequest(claims, uuid(requestId, "requestId"), key, deadline());
    }

    /**
     * 초대 코드 해석 (GROMO-1760, LLD §3.10). 조회 성격이라 멱등키를 요구하지 않는다.
     * 형식·폐기 판정(422/410)은 상류 몫이다 — 여기서 미리 걸러 의미를 갉아먹지 않는다.
     */
    @PostMapping(value = "/invitations/resolve", consumes = "application/json")
    public InvitationResolved resolveInvitation(@RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        return islands.resolveInvitation(claims, requiredText(body, "code", CODE_MAX), deadline());
    }

    /** 섬 초대 발급 (GROMO-1760, LLD §3.11). 본문 없음, 활성 주민만 발급된다. */
    @PostMapping("/islands/{islandId}/invitations")
    public IslandInvitationIssued issueInvitation(@PathVariable String islandId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return islands.issueInvitation(claims, uuid(islandId, "islandId"), key, deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    /** 필수 문자열 — 없거나 타입이 다르면 400, 비었거나 길이를 넘기면 422 다(LLD §2). */
    private static String requiredText(JsonNode body, String field, int max) {
        JsonNode node = body.get(field);
        if (node == null || !node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        String value = node.stringValue();
        if (value.isBlank() || value.length() > max) {
            // 저장 전 임의로 잘라 성공시키지 않는다(LLD §2).
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return value;
    }

    /** 선택 문자열 — 명시된 null 은 400 이다(키가 아예 없는 것과 구분한다). */
    private static String optionalText(JsonNode body, String field, int max) {
        JsonNode node = body.get(field);
        if (node == null) {
            return null;
        }
        if (!node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        String value = node.stringValue();
        if (value.length() > max) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, field);
        }
        return value;
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

    /** {@code limit} — 1~100 경계는 {@code CursorScope} 가 422 로 강제한다. */
    private static int limit(HttpServletRequest request, int fallback) {
        String raw = single(request, "limit");
        if (raw == null) {
            return fallback;
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

package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.IslandMembershipResponses.CurrentIslandView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.InvitationResolvedView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.IslandArrivalView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.IslandCreatedView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.IslandInvitationView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.IslandJoinResultView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.JoinRequestCancelView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.JoinRequestStatusView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.TelescopePinView;
import com.oneorthree.business.api.dto.IslandMembershipResponses.TelescopeView;
import com.oneorthree.business.api.dto.IslandNoticeResponses.NoticeDeletedView;
import com.oneorthree.business.api.dto.IslandPage;
import com.oneorthree.business.api.dto.MyIslandsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
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
    /** 「신청 중」 기본 개수 — 한 사람이 동시에 걸어 둘 수 있는 신청 수가 적어 한 화면이면 충분하다. */
    private static final int MY_JOIN_REQUESTS_LIMIT_DEFAULT = 20;
    // 초대 code·token 크기는 내부 계약(InvitationResolveCommandRequest·JoinIslandCommandRequest)과
    // 같게 둔다 — 여기서 더 느슨하게 받으면 초과분이 400/422 로 갈리는 경계가 상류와 어긋난다.
    private static final int CODE_MAX = 32;
    private static final int TOKEN_MAX = 64;
    /** 섬 생성 본문의 화이트리스트 — password 는 없다(LLD §1). maxMembers 는 GROMO-1993 에서 열었다. */
    private static final Set<String> CREATE_KEYS = Set.of("name", "intro", "approvalRequired", "maxMembers");
    /** 가입 본문의 화이트리스트 — {@code origin} 은 GROMO-2260 에서 열었다. */
    private static final Set<String> JOIN_KEYS = Set.of("invitationToken", "origin");
    private static final Set<String> JOIN_ORIGINS = Set.of("visit", "telescope");
    /** 망원경 핀 넣기 본문의 출처 — 정확히 이 둘이다(GROMO-2268). Data 의 V115 CHECK 와 같다. */
    private static final Set<String> PIN_SOURCES = Set.of("magazine", "observatory");
    /** 초대 해석 본문의 화이트리스트 — {@code arrive} 는 GROMO-2264 에서 열었다(도착 opt-in). */
    private static final Set<String> RESOLVE_KEYS = Set.of("code", "arrive");
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
    public ResponseEntity<IslandCreatedView> create(@RequestBody JsonNode body, HttpServletRequest request) {
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
        IslandCreatedView created = islands.create(claims, name, intro, approvalRequired.booleanValue(),
                maxMembers, key, properties.deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /** 이름 검색 (LLD §3.2). 현재 섬 전망대가 필요하다. */
    @GetMapping("/islands")
    public IslandPage islands(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return islands.search(claims, single(request, "q"), single(request, "cursor"),
                limit(request, SEARCH_LIMIT_DEFAULT), properties.deadline());
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
                limit(request, DISCOVER_LIMIT_DEFAULT), properties.deadline());
    }

    /** 섬 하나 (LLD §3.4). 주민이면 상세, 비소속이면 공개 요약이다. */
    @GetMapping("/islands/{islandId}")
    public Object island(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return islands.island(claims, PublicIds.uuid(islandId, "islandId"), properties.deadline());
    }

    /** 내 섬 목록 (LLD §3.5). */
    @GetMapping("/me/islands")
    public MyIslandsResponse myIslands(HttpServletRequest request) {
        return islands.myIslands(sessions.requireSession(request), properties.deadline());
    }

    /** 망원경 목록 (GROMO-2265, 섬 외부 계약 §5). 전망대 게이트가 없고 게스트도 읽는다. */
    @GetMapping("/me/telescope")
    public TelescopeView telescope(HttpServletRequest request) {
        return islands.telescope(sessions.requireSession(request), properties.deadline());
    }

    /**
     * 망원경에 섬 넣기 (GROMO-2268, 섬 외부 계약 §6). 본문은 {@code {islandId, source}} 에 선택 {@code promotionId}
     * (GROMO-2289, 잡지 홍보 칸에서 넣었을 때 그 홍보 — 「잡지 경유」 집계용) 뿐이고 {@code source} 는 {@code magazine}·
     * {@code observatory} 뿐이다. 새 핀이면 201, 이미 있던 핀이면 200 으로 같은 항목을 돌려준다.
     * 게스트도 쓴다. 같은 핀을 다시 넣어도 아무것도 바뀌지 않아 {@code Idempotency-Key} 는 받지 않는다.
     */
    @PostMapping(value = "/me/telescope/pins", consumes = "application/json")
    public ResponseEntity<TelescopePinView> pinTelescope(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode islandId = body.get("islandId");
        if (islandId == null || !islandId.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "islandId");
        }
        JsonNode source = body.get("source");
        if (source == null || !source.isString() || !PIN_SOURCES.contains(source.stringValue())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "source");
        }
        // promotionId 는 없거나 null 이거나 UUID 문자열이다.
        JsonNode promotionId = body.get("promotionId");
        UUID promotion = null;
        if (promotionId != null && !promotionId.isNull()) {
            if (!promotionId.isString()) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "promotionId");
            }
            promotion = PublicIds.uuid(promotionId.stringValue(), "promotionId", ApiErrorCode.INVALID_REQUEST);
        }
        // 위 셋 말고 다른 키가 섞여 있으면 거절한다 — 주체는 서명된 세션에서만 온다.
        if (body.size() != (promotionId == null ? 2 : 3)) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        IslandMembershipUseCase.TelescopePinned pinned = islands.pinTelescope(claims,
                PublicIds.uuid(islandId.stringValue(), "islandId"), source.stringValue(), promotion,
                properties.deadline());
        return ResponseEntity.status(pinned.created() ? HttpStatus.CREATED : HttpStatus.OK).body(pinned.view());
    }

    /** 망원경에서 섬 빼기 (GROMO-2268). 핀이 없어도 200 {@code {deleted:true}} 다. */
    @DeleteMapping("/me/telescope/pins/{islandId}")
    public NoticeDeletedView unpinTelescope(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return NoticeDeletedView.from(islands.unpinTelescope(claims, PublicIds.uuid(islandId, "islandId"),
                properties.deadline()));
    }

    /** 현재 섬 이동 (LLD §3.6). */
    @PutMapping(value = "/me/current-island", consumes = "application/json")
    public CurrentIslandView switchCurrentIsland(@RequestBody JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject() || body.size() != 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode islandId = body.get("islandId");
        if (islandId == null || !islandId.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "islandId");
        }
        return islands.switchCurrentIsland(claims, PublicIds.uuid(islandId.stringValue(), "islandId"), key,
                properties.deadline());
    }

    /**
     * 섬 가입 (GROMO-1760, LLD §3.7).
     *
     * <p>본문은 선택이다 — 없음·빈 객체·{@code {invitationToken?, origin?}} 만 받고 그 밖의 키는 거절한다.
     * 즉시 가입이면 {@code active}+새 current, 승인제면 {@code pending} 이다. {@code origin} 은
     * {@code visit}(기본)·{@code telescope} 둘뿐이다(GROMO-2260) — 망원경 가입은 그 섬으로 옮기지 않는다.
     */
    @PostMapping("/islands/{islandId}/memberships")
    public IslandJoinResultView join(@PathVariable String islandId,
            @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        String invitationToken = null;
        String origin = null;
        if (body != null && !body.isNull()) {
            if (!body.isObject() || !JOIN_KEYS.containsAll(body.propertyNames())) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
            }
            invitationToken = optionalText(body, "invitationToken", TOKEN_MAX);
            origin = optionalText(body, "origin", TOKEN_MAX);
            if (origin != null && !JOIN_ORIGINS.contains(origin)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "origin");
            }
        }
        return islands.join(claims, PublicIds.uuid(islandId, "islandId"), invitationToken, origin, key,
                properties.deadline());
    }

    /**
     * 섬 도착 (GROMO-2260, 섬 외부 계약 §1) — 항해·방문이 끝난 자리에서 부른다. 본문은 없다.
     *
     * <p>현재 섬을 옮기는 명령이라 {@code PUT /me/current-island} 처럼 {@code Idempotency-Key}(UUID)가 필수다 —
     * 같은 키의 재시도는 처음 결과를 재생할 뿐, 그 사이 다른 섬으로 간 사람을 되돌리지 않는다.
     */
    @PostMapping("/islands/{islandId}/arrivals")
    public IslandArrivalView arrive(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return islands.arrive(claims, PublicIds.uuid(islandId, "islandId"), key, properties.deadline());
    }

    /** 첫 항해 화면 체험의 도착. 최초 여부는 앱 로컬 정책이고 서버는 사용 횟수를 제한하지 않는다. */
    @PostMapping("/islands/{islandId}/intro-arrivals")
    public IslandArrivalView introArrive(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return islands.introArrive(claims, PublicIds.uuid(islandId, "islandId"), key, properties.deadline());
    }

    /**
     * 내 가입 신청 목록 (GROMO-2047, LLD §3.12) — explore 화면의 「신청 중」 조각이다.
     *
     * <p>{@code /me/join-requests/{requestId}}(§3.8) 와 세그먼트 수가 달라 경로가 겹치지 않는다.
     * 신청이 없으면 404 가 아니라 빈 목록 + 200 이다 — 「신청한 적 없음」은 실패가 아니다.
     */
    @GetMapping("/me/join-requests")
    public IslandMembershipUseCase.MyJoinRequests myJoinRequests(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return islands.myJoinRequests(claims, single(request, "cursor"),
                limit(request, MY_JOIN_REQUESTS_LIMIT_DEFAULT), properties.deadline());
    }

    /** 가입 요청 상태 (GROMO-1760, LLD §3.8). 남의 요청은 상류가 404 로 접는다. */
    @GetMapping("/me/join-requests/{requestId}")
    public JoinRequestStatusView joinRequest(@PathVariable String requestId, HttpServletRequest request) {
        return islands.joinRequest(sessions.requireSession(request),
                PublicIds.uuid(requestId, "requestId"), properties.deadline());
    }

    /** 가입 요청 취소 (GROMO-1760, LLD §3.9). 본인의 pending 만 종결된다. */
    @DeleteMapping("/me/join-requests/{requestId}")
    public JoinRequestCancelView cancelJoinRequest(@PathVariable String requestId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return islands.cancelJoinRequest(claims, PublicIds.uuid(requestId, "requestId"), key, properties.deadline());
    }

    /**
     * 초대 코드 해석 (GROMO-1760, LLD §3.10). 본문은 {@code {code, arrive?}} 다.
     *
     * <p>기본은 읽기 전용 미리보기다. {@code arrive=true} 일 때만 그 섬에 항해 없이 도착하고, 누구나 가입 섬이면 가입까지
     * 한다(GROMO-2264) — 승인제 섬은 도착만이다(가입 신청은 방문자가 직접). 도착은 명시적 opt-in 이라 미리보기만 하는 앱은
     * 아무것도 바뀌지 않는다. 다시 불러도 같은 상태로 수렴해 멱등키를 요구하지 않는다.
     * 형식·폐기 판정(422/410)은 상류 몫이다 — 여기서 미리 걸러 의미를 갉아먹지 않는다.
     */
    @PostMapping(value = "/invitations/resolve", consumes = "application/json")
    public InvitationResolvedView resolveInvitation(@RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        if (body == null || !body.isObject() || body.size() == 0 || !RESOLVE_KEYS.containsAll(body.propertyNames())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        JsonNode arrive = body.get("arrive");
        // 명시된 null·문자열·숫자는 400 이다 — 「안 보냄」(미리보기)과 구분한다.
        if (arrive != null && !arrive.isBoolean()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "arrive");
        }
        return islands.resolveInvitation(claims, requiredText(body, "code", CODE_MAX),
                arrive != null && arrive.booleanValue(), properties.deadline());
    }

    /** 섬 초대 발급 (GROMO-1760, LLD §3.11). 본문 없음, 활성 주민만 발급된다. */
    @PostMapping("/islands/{islandId}/invitations")
    public IslandInvitationView issueInvitation(@PathVariable String islandId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        return islands.issueInvitation(claims, PublicIds.uuid(islandId, "islandId"), key, properties.deadline());
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
}

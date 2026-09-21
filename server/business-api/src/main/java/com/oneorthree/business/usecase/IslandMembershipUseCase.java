package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.IslandPage;
import com.oneorthree.business.api.dto.MyIslandsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.CurrentIsland;
import com.oneorthree.business.upstream.data.dto.InvitationResolved;
import com.oneorthree.business.upstream.data.dto.IslandCreated;
import com.oneorthree.business.upstream.data.dto.IslandDiscoverPage;
import com.oneorthree.business.upstream.data.dto.IslandInvitationIssued;
import com.oneorthree.business.upstream.data.dto.IslandSearchPage;
import com.oneorthree.business.upstream.data.dto.IslandView;
import com.oneorthree.business.upstream.data.dto.JoinIslandResult;
import com.oneorthree.business.upstream.data.dto.JoinRequestCancel;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.data.dto.MyIslands;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 생성·조회·탐색·현재 섬 이동의 공개 유스케이스 (GROMO-1759).
 *
 * <p>Data 의 도메인 실패를 공개 오류로 <b>정확히 (상태, 코드) 쌍이 맞을 때만</b> 옮긴다. 등록되지
 * 않은 판정은 그대로 올려 502 가 되게 둔다 — 상류가 같은 코드의 상태를 바꿨는데 공개 표가 조용히
 * 어긋나는 것보다, 계약 불일치로 시끄럽게 실패하는 편이 낫다(GROMO-1764 선례).
 */
@Service
@RequiredArgsConstructor
public class IslandMembershipUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            // Data 의 bean 검증 거절 — 섬 이름 안전 문자 규칙은 Data 에만 있다(정의가 하나). 코드·상태가
            // 같아 그대로 옮긴다. 필드는 알 수 없어 비운다(Data 응답에 필드가 없다).
            Map.entry("INVALID_REQUEST", new PublicFailure(ApiErrorCode.INVALID_REQUEST, null)),
            // 비공개 섬의 무자격 직접 조회, 그리고 «내 소속이 아닌 섬으로 이동» 둘 다 403 이다.
            Map.entry("MEMBER_ONLY", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            // 전망대 미해금 — 공개 표면에는 이미 시설 전용 코드가 있다.
            Map.entry("OBSERVATORY_LOCKED", new PublicFailure(ApiErrorCode.FACILITY_LOCKED, null)),
            // 진행 중 집중 세션이 있어 이동/생성을 거절했다(LLD §3.1·§3.6).
            Map.entry("SESSION_IN_PROGRESS", new PublicFailure(ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("GROUP_LIMIT_EXCEEDED", new PublicFailure(ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("CONCURRENT_UPDATE", new PublicFailure(ApiErrorCode.VERSION_CONFLICT, null)),
            // ── GROMO-1760 섬 가입·초대. 422/410 의 원본 의미를 유지한다 — 형식 오류는 범위
            // 초과, 폐기·만료는 전용 코드(ApiErrorCode 의 동명 상수가 registeredUpstream 으로 붙는다).
            Map.entry("INVITATION_CODE_INVALID", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, null)),
            Map.entry("INVITATION_REQUIRED", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("ISLAND_JOIN_UNAVAILABLE", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("ALREADY_MEMBER", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "islandId")),
            Map.entry("KICKED_CANNOT_REJOIN", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("ROOM_FULL", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "islandId")),
            // 남의 요청은 범위 밖 — 「없다」와 같은 404 로 접어 소유 정보를 새지 않는다(LLD §3.8).
            Map.entry("JOIN_REQUEST_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "requestId")),
            Map.entry("JOIN_REQUEST_TERMINAL", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "requestId")));

    private static final String RESOURCE_SEARCH = "islands";
    private static final String RESOURCE_DISCOVER = "island-discover";
    private static final String SORT_RECENT = "recent";
    private static final String SORT_RELEVANCE = "relevance";
    private static final String SORT_SHUFFLE = "shuffle";
    private static final String SCOPE_MEMBER = "member";
    private static final String SCOPE_VISITOR = "visitor";

    private final DataApiClient data;
    private final ObjectProvider<SignedCursorCodec> cursorCodecs;
    private final SecureRandom seeds = new SecureRandom();

    /** 섬 생성 (LLD §3.1). */
    public IslandCreated create(AccessTokenClaims claims, String name, String intro,
            boolean approvalRequired, Integer maxMembers, UUID key, Deadline deadline) {
        return relay(() -> data.createIsland(claims.userId(), name, intro, approvalRequired, maxMembers,
                key, deadline));
    }

    /** 현재 섬 이동 (LLD §3.6). */
    public CurrentIsland switchCurrentIsland(AccessTokenClaims claims, UUID islandId, UUID key,
            Deadline deadline) {
        return relay(() -> data.switchCurrentIsland(claims.userId(), islandId, key, deadline));
    }

    /** 내 섬 목록 (LLD §3.5). 페이지가 없으므로 커서 서명이 필요 없다. */
    public MyIslandsResponse myIslands(AccessTokenClaims claims, Deadline deadline) {
        MyIslands islands = relay(() -> data.fetchMyIslands(claims.userId(), deadline));
        if (islands == null) {
            throw new UpstreamContractMismatchException("내 섬 목록 응답이 없습니다");
        }
        return new MyIslandsResponse(islands.items(), null, islands.currentIslandId());
    }

    /**
     * 이름 검색 (LLD §3.2).
     *
     * <p>검색어를 cursor scope 의 필터에 넣는다 — 검색어가 바뀌면 기존 커서는 위조로 판정돼 첫
     * 페이지부터 다시 시작한다(§5 "검색어/탭/선택 섬/limit 변경은 첫 페이지부터").
     */
    public IslandPage search(AccessTokenClaims claims, String q, String cursor, int limit,
            Deadline deadline) {
        boolean byName = q != null && !q.isBlank();
        CursorScope scope = new CursorScope(claims.userId(), RESOURCE_SEARCH,
                byName ? Map.of("q", q) : Map.of(), byName ? SORT_RELEVANCE : SORT_RECENT, limit);
        CursorBoundary boundary = codec().decode(cursor, scope);
        UUID after = boundary == null ? null : cursorUuid(boundary.sortKey());

        IslandSearchPage page = relay(() ->
                data.searchIslands(claims.userId(), byName ? q : null, after, limit, deadline));
        if (page == null) {
            throw new UpstreamContractMismatchException("섬 검색 응답이 없습니다");
        }
        String next = page.nextIslandId() == null ? null
                : codec().encode(scope, new CursorBoundary(
                        page.nextIslandId().toString(), page.nextIslandId().toString()));
        return new IslandPage(page.items(), next);
    }

    /**
     * 첫 소속 탐색 (LLD §3.3).
     *
     * <p>첫 페이지에서 <b>탐색 seed</b> 를 뽑아 커서에 실어 나른다. 그 seed 가 한 탐색 세션의 순서를
     * 고정하는 「무작위 세션 핸들」이고(§5), 수명은 커서 서명의 만료창이다. Business 전역 메모리에
     * 순서를 두지 않으므로 인스턴스가 달라도 같은 순서가 나온다(HLD §4).
     */
    public IslandPage discover(AccessTokenClaims claims, String cursor, int limit, Deadline deadline) {
        CursorScope scope = new CursorScope(claims.userId(), RESOURCE_DISCOVER, Map.of(),
                SORT_SHUFFLE, limit);
        CursorBoundary boundary = codec().decode(cursor, scope);
        String seed = boundary == null ? newSeed() : boundary.sortKey();
        String after = boundary == null ? null : boundary.tieBreaker();

        IslandDiscoverPage page = relay(() ->
                data.discoverIslands(claims.userId(), seed, after, limit, deadline));
        if (page == null) {
            throw new UpstreamContractMismatchException("섬 발견 응답이 없습니다");
        }
        String next = page.nextHandle() == null ? null
                : codec().encode(scope, new CursorBoundary(seed, page.nextHandle()));
        return new IslandPage(page.items(), next);
    }

    /**
     * 섬 하나 (LLD §3.4). 주민이면 상세, 비소속이면 공개 요약을 <b>그대로</b> 내려보낸다.
     *
     * <p>반환 타입이 {@code Object} 인 것은 공개 계약이 두 모양의 합집합이기 때문이다. 어느 쪽인지는
     * <b>상류가</b> 정하고 Business 는 봉투만 벗긴다 — 요청이 범위를 고를 여지를 만들지 않는다.
     */
    public Object island(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        IslandView view = relay(() -> data.fetchIsland(claims.userId(), islandId, deadline));
        if (view == null) {
            throw new UpstreamContractMismatchException("섬 상세 응답이 없습니다");
        }
        if (SCOPE_MEMBER.equals(view.scope()) && view.member() != null) {
            return view.member();
        }
        if (SCOPE_VISITOR.equals(view.scope()) && view.visitor() != null) {
            return view.visitor();
        }
        throw new UpstreamContractMismatchException("섬 상세 범위를 판별할 수 없습니다");
    }

    /**
     * 섬 가입 (GROMO-1760, LLD §3.7). 즉시 가입이면 {@code active}+새 current, 승인제면
     * {@code pending} — 어느 쪽인지는 상류 판정이고 응답 형태로만 구분한다.
     */
    public JoinIslandResult join(AccessTokenClaims claims, UUID islandId, String invitationToken,
            UUID key, Deadline deadline) {
        JoinIslandResult result = relay(() ->
                data.joinIsland(claims.userId(), islandId, invitationToken, key, deadline));
        if (result == null || result.islandId() == null || result.status() == null) {
            throw new UpstreamContractMismatchException("가입 응답이 완전하지 않습니다");
        }
        if (!islandId.equals(result.islandId())) {
            throw new UpstreamContractMismatchException("가입 응답의 섬이 요청과 다릅니다");
        }
        // 형태 불변식 — pending 에는 requestId 가, active 에는 currentIslandId 가 있어야 한다.
        if (("pending".equals(result.status()) && result.requestId() == null)
                || ("active".equals(result.status()) && result.currentIslandId() == null)) {
            throw new UpstreamContractMismatchException("가입 응답의 상태와 필드가 어긋납니다");
        }
        return result;
    }

    /**
     * 가입 요청 상태 (GROMO-1760, LLD §3.8). 읽기가 현재 섬을 바꾸지 않는다 — 이 경로에는
     * current 를 쓰는 호출이 없다.
     */
    public JoinRequestStatus joinRequest(AccessTokenClaims claims, UUID requestId,
            Deadline deadline) {
        JoinRequestStatus status = relay(() ->
                data.fetchJoinRequest(claims.userId(), requestId, deadline));
        if (status == null || status.id() == null || status.status() == null) {
            throw new UpstreamContractMismatchException("가입 요청 응답이 완전하지 않습니다");
        }
        if (!requestId.equals(status.id())) {
            throw new UpstreamContractMismatchException("가입 요청 응답의 id 가 요청과 다릅니다");
        }
        return status;
    }

    /**
     * 가입 요청 취소 (GROMO-1760, LLD §3.9). 성공은 항상 {@code cancelled} — 같은 키의 재생도
     * 같은 값이고, 이미 승인된 요청은 상류가 409 로 막는다.
     */
    public JoinRequestCancel cancelJoinRequest(AccessTokenClaims claims, UUID requestId, UUID key,
            Deadline deadline) {
        JoinRequestCancel result = relay(() ->
                data.cancelJoinRequest(claims.userId(), requestId, key, deadline));
        if (result == null || result.id() == null || result.status() == null) {
            throw new UpstreamContractMismatchException("취소 응답이 완전하지 않습니다");
        }
        if (!requestId.equals(result.id())) {
            throw new UpstreamContractMismatchException("취소 응답의 id 가 요청과 다릅니다");
        }
        return result;
    }

    /**
     * 초대 코드 해석 (GROMO-1760, LLD §3.10). 조회 성격이라 멱등키가 없다.
     * {@code invitationToken} 은 여기서 검증·해석하지 않고 가입 명령에 그대로 전달한다.
     */
    public InvitationResolved resolveInvitation(AccessTokenClaims claims, String code,
            Deadline deadline) {
        InvitationResolved resolved = relay(() ->
                data.resolveInvitation(claims.userId(), code, deadline));
        if (resolved == null || resolved.island() == null
                || resolved.invitationToken() == null || resolved.invitationToken().isBlank()) {
            throw new UpstreamContractMismatchException("초대 해석 응답이 완전하지 않습니다");
        }
        return resolved;
    }

    /**
     * 섬 초대 발급 (GROMO-1760, LLD §3.11). 활성 주민 판정·코드 재사용·세대 재발급은 상류
     * 수명주기다 — 여기서는 응답 완전성만 확인한다.
     */
    public IslandInvitationIssued issueInvitation(AccessTokenClaims claims, UUID islandId,
            UUID key, Deadline deadline) {
        IslandInvitationIssued issued = relay(() ->
                data.issueIslandInvitation(claims.userId(), islandId, key, deadline));
        if (issued == null || issued.code() == null || issued.code().isBlank()
                || issued.url() == null || issued.url().isBlank()) {
            throw new UpstreamContractMismatchException("초대 발급 응답이 완전하지 않습니다");
        }
        return issued;
    }

    // ---------------------------------------------------------------- 내부

    /**
     * 커서 서명기 — 없으면 <b>첫 페이지로 접지 않고</b> 503 이다.
     *
     * <p>{@code SignedCursorCodec} 은 {@code business.cursor.enabled=true} 와 독립 서명키가 있을 때만
     * 등록된다. 키가 없는 환경에서 커서를 «없는 셈» 치고 첫 페이지를 돌려주면 위조 커서를 조용히
     * 허용하는 것과 같아진다. 그래서 명시적으로 실패시킨다 — 이 두 목록만 영향을 받고 나머지 4종은
     * 정상 동작한다.
     *
     * <p><b>배포 선행 조건.</b> 이 설정에 값이 있는 프로파일은 지금 {@code ci} 뿐이다. 그래서 이
     * 실패는 «테스트는 전부 통과하는데 배포하면 두 목록만 죽는» 모양으로 나타난다 — 부팅은
     * 정상이고(빈이 조건부라 없을 뿐이다) 헬스체크도 통과하며, {@code GET /islands} 와
     * {@code GET /islands/discover} 의 첫 요청에서야 503 이 된다. dev/prod 에
     * {@code business.cursor.*} 를 주입하는 것이 이 티켓의 배포 선행 조건이다.
     */
    private SignedCursorCodec codec() {
        SignedCursorCodec codec = cursorCodecs.getIfAvailable();
        if (codec == null) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        return codec;
    }

    private String newSeed() {
        byte[] value = new byte[8];
        seeds.nextBytes(value);
        return HexFormat.of().formatHex(value);
    }

    /** 커서에 실린 경계 id — 서명은 통과했어도 값 자체는 다시 검증한다. */
    private static UUID cursorUuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
    }

    private <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
    }

    private RuntimeException mapped(UpstreamDomainException error) {
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}

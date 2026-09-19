package com.oneorthree.business.usecase;

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
import com.oneorthree.business.upstream.data.dto.IslandJoinRequestsPage;
import com.oneorthree.business.upstream.data.dto.IslandManaged;
import com.oneorthree.business.upstream.data.dto.IslandMembersPage;
import com.oneorthree.business.upstream.data.dto.JoinRequestAnswer;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 관리·주민 잔여 6종의 공개 유스케이스 (GROMO-1802, 섬 관리 LLD §3).
 *
 * <p>권한·상태·원자 변경은 전부 Data 가 판정한다. 여기서 하는 것은 목록 커서 서명과 <b>정확히 (상태, 코드)
 * 쌍이 맞는</b> 상류 실패의 공개 코드 변환뿐이다 — 등록되지 않은 판정은 그대로 올려 502 가 되게 둔다
 * ({@code IslandMembershipUseCase} 와 같은 규칙).
 *
 * <p>상류가 400 으로 내는 legacy 코드 둘({@code CANNOT_KICK_SELF}·{@code HOST_WITHDRAW})은 공개 계약에서
 * 409 다(LLD §3.6·§3.7) — 요청 모양이 아니라 현재 상태가 거절 이유이기 때문이다. 상류 상태를 바꾸면 legacy
 * 앱 분기가 깨지므로 여기서 옮긴다. 강퇴 이력이 있는 신청자의 승인 거절({@code KICKED_CANNOT_REJOIN} 403)도
 * 방장에게는 권한 문제가 아니라 상태 충돌이라 409 로 옮긴다.
 */
@Service
@RequiredArgsConstructor
public class IslandManagementUseCase {

    public static final int DEFAULT_LIMIT = 30;

    private static final String RESOURCE_MEMBERS = "islands/members";
    private static final String RESOURCE_JOIN_REQUESTS = "islands/join-requests";
    private static final String SORT_CREATED_ASC = "created-asc";

    /** 모든 계약이 공유하는 판정 — 게이트·섬·요청자·역할. */
    private static final Map<String, PublicFailure> COMMON = Map.ofEntries(
            Map.entry("ISLAND_MANAGEMENT_NOT_READY", new PublicFailure(503, ApiErrorCode.SERVICE_UNAVAILABLE, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            Map.entry("USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("NOT_OWNER", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "islandId")),
            // 그룹 행 낙관락 — legacy 수정과 겹친 드문 경합이다.
            Map.entry("CONCURRENT_UPDATE", new PublicFailure(409, ApiErrorCode.VERSION_CONFLICT, null)));

    /** 정보 수정 — 이름 안전 문자 규칙은 Data 에만 있다(정의가 하나). */
    private static final Map<String, PublicFailure> MANAGE = with(
            Map.entry("INVALID_REQUEST", new PublicFailure(400, ApiErrorCode.INVALID_REQUEST, null)),
            // 빈 이름 — 공개 경계가 먼저 거르지만 닿으면 같은 422 다(api-platform policy OUT_OF_RANGE).
            Map.entry("ISLAND_NAME_BLANK", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "name")));

    private static final Map<String, PublicFailure> ANSWER = with(
            Map.entry("JOIN_REQUEST_NOT_FOUND", new PublicFailure(404, ApiErrorCode.NOT_FOUND, "requestId")),
            // 신청자 계정이 사라졌으면 요청도 사라진 것과 같다 — 방장의 재로그인 코드가 아니다.
            Map.entry("TARGET_USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.NOT_FOUND, "requestId")),
            Map.entry("JOIN_REQUEST_TERMINAL", new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, "requestId")),
            Map.entry("ROOM_FULL", new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, "islandId")),
            Map.entry("GROUP_LIMIT_EXCEEDED", new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, "requestId")),
            Map.entry("ALREADY_MEMBER", new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, "requestId")),
            Map.entry("KICKED_CANNOT_REJOIN", new PublicFailure(403, ApiErrorCode.STATE_CONFLICT, "requestId")),
            Map.entry("INVITATION_EXPIRED", new PublicFailure(410, ApiErrorCode.INVITATION_EXPIRED, "requestId")));

    private static final Map<String, PublicFailure> KICK = with(
            Map.entry("CANNOT_KICK_SELF", new PublicFailure(400, ApiErrorCode.STATE_CONFLICT, "userId")),
            Map.entry("NOT_FOUND", new PublicFailure(404, ApiErrorCode.NOT_FOUND, "userId")),
            Map.entry("TARGET_USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.NOT_FOUND, "userId")));

    private static final Map<String, PublicFailure> LEAVE = with(
            Map.entry("HOST_WITHDRAW", new PublicFailure(400, ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("SESSION_IN_PROGRESS", new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, null)));

    private final DataApiClient data;
    private final ObjectProvider<SignedCursorCodec> cursorCodecs;

    /** 섬 정보 수정 (LLD §3.1). {@code fields} 는 앱이 보낸 키만 담는다 — 부재가 «미변경» 이다. */
    public IslandManaged manage(AccessTokenClaims claims, UUID islandId, Map<String, Object> fields, UUID key,
            Deadline deadline) {
        IslandManaged result = relay(() -> data.manageIsland(claims.userId(), islandId, fields, key, deadline),
                MANAGE);
        if (result == null || !islandId.equals(result.id()) || result.version() < 0) {
            throw new UpstreamContractMismatchException("섬 정보 수정 응답이 요청과 다릅니다");
        }
        return result;
    }

    /**
     * 주민 목록 (LLD §3.2). 커서는 사용자·섬·정렬·limit 에 묶인다 — 섬이나 limit 이 바뀌면 첫 페이지부터다.
     * 커서는 인가 증명이 아니다: 매 페이지 Data 가 활성 주민인지 다시 본다.
     */
    public MembersPage members(AccessTokenClaims claims, UUID islandId, String cursor, int limit,
            Deadline deadline) {
        CursorScope scope = scope(claims, RESOURCE_MEMBERS, islandId, limit);
        CursorBoundary boundary = codec().decode(cursor, scope);
        IslandMembersPage page = relay(() -> data.fetchIslandMembers(claims.userId(), islandId,
                boundary == null ? null : instant(boundary.sortKey()),
                boundary == null ? null : id(boundary.tieBreaker()), limit, deadline), Map.of());
        if (page == null || page.items() == null || page.version() < 0
                || (page.nextJoinedAt() == null) != (page.nextMembershipId() == null)) {
            throw new UpstreamContractMismatchException("주민 목록 응답이 완전하지 않습니다");
        }
        String next = page.nextJoinedAt() == null ? null : codec().encode(scope,
                new CursorBoundary(page.nextJoinedAt().toString(), page.nextMembershipId().toString()));
        return new MembersPage(page.items(), next, page.version());
    }

    /** 신청자 목록 (LLD §3.3) — 방장 전용. 403 을 빈 목록으로 접지 않는다. */
    public JoinRequestsPage joinRequests(AccessTokenClaims claims, UUID islandId, String cursor, int limit,
            Deadline deadline) {
        CursorScope scope = scope(claims, RESOURCE_JOIN_REQUESTS, islandId, limit);
        CursorBoundary boundary = codec().decode(cursor, scope);
        IslandJoinRequestsPage page = relay(() -> data.fetchIslandJoinRequests(claims.userId(), islandId,
                boundary == null ? null : instant(boundary.sortKey()),
                boundary == null ? null : id(boundary.tieBreaker()), limit, deadline), Map.of());
        if (page == null || page.items() == null
                || (page.nextCreatedAt() == null) != (page.nextRequestId() == null)) {
            throw new UpstreamContractMismatchException("신청자 목록 응답이 완전하지 않습니다");
        }
        String next = page.nextCreatedAt() == null ? null : codec().encode(scope,
                new CursorBoundary(page.nextCreatedAt().toString(), page.nextRequestId().toString()));
        return new JoinRequestsPage(page.items(), next);
    }

    /** 가입 요청 승인·거절 (LLD §3.4). 승인이면 {@code memberId} 가 있고 거절이면 null 이다. */
    public JoinRequestAnswer answer(AccessTokenClaims claims, UUID islandId, UUID requestId, boolean approve,
            UUID key, Deadline deadline) {
        JoinRequestAnswer result = relay(() -> data.answerJoinRequest(claims.userId(), islandId, requestId,
                approve ? "approve" : "reject", key, deadline), ANSWER);
        boolean shaped = result != null && result.version() > 0 && (approve
                ? "approved".equals(result.status()) && result.memberId() != null
                : "rejected".equals(result.status()) && result.memberId() == null);
        if (!shaped) {
            throw new UpstreamContractMismatchException("가입 요청 처리 응답의 상태와 필드가 어긋납니다");
        }
        return result;
    }

    /** 주민 강퇴 (LLD §3.6). */
    public Removed kick(AccessTokenClaims claims, UUID islandId, UUID targetUserId, UUID key, Deadline deadline) {
        JsonNode result = relay(() -> data.kickIslandMember(claims.userId(), islandId, targetUserId, key, deadline),
                KICK);
        requireTrue(result, "removed");
        return new Removed(true);
    }

    /** 본인 나가기 (LLD §3.7). */
    public Left leave(AccessTokenClaims claims, UUID islandId, UUID key, Deadline deadline) {
        JsonNode result = relay(() -> data.leaveIsland(claims.userId(), islandId, key, deadline), LEAVE);
        requireTrue(result, "left");
        return new Left(true);
    }

    // ---------------------------------------------------------------- 내부

    private static CursorScope scope(AccessTokenClaims claims, String resource, UUID islandId, int limit) {
        return new CursorScope(claims.userId(), resource, Map.of("islandId", islandId.toString()),
                SORT_CREATED_ASC, limit);
    }

    /** 커서 서명기 — 없으면 첫 페이지로 접지 않고 503 이다({@code IslandMembershipUseCase#codec} 와 같은 이유). */
    private SignedCursorCodec codec() {
        SignedCursorCodec codec = cursorCodecs.getIfAvailable();
        if (codec == null) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        return codec;
    }

    /** 서명은 통과했어도 경계 값 자체는 다시 검증한다. */
    private static Instant instant(String value) {
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
    }

    private static UUID id(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
    }

    private static void requireTrue(JsonNode result, String field) {
        if (result == null || !result.isObject() || result.size() != 1 || !result.path(field).isBoolean()
                || !result.path(field).booleanValue()) {
            throw new UpstreamContractMismatchException("섬 이탈 응답 계약 불일치");
        }
    }

    private <T> T relay(Supplier<T> upstream, Map<String, PublicFailure> specific) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e, specific);
        }
    }

    private static RuntimeException mapped(UpstreamDomainException error, Map<String, PublicFailure> specific) {
        PublicFailure failure = specific.getOrDefault(error.getCode(), COMMON.get(error.getCode()));
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.upstreamStatus() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    @SafeVarargs
    private static Map<String, PublicFailure> with(Map.Entry<String, PublicFailure>... entries) {
        Map<String, PublicFailure> merged = new HashMap<>(COMMON);
        for (Map.Entry<String, PublicFailure> entry : entries) {
            merged.put(entry.getKey(), entry.getValue());
        }
        return Map.copyOf(merged);
    }

    /** 상류 실패 한 줄 — 기대하는 상류 상태, 공개 코드, 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }

    /** 공개 주민 목록 한 페이지 — {@code nextCursor} 는 서명 토큰, {@code version} 은 목록 버전이다. */
    public record MembersPage(List<IslandMembersPage.Item> items, String nextCursor, long version) {
    }

    /** 공개 신청자 목록 한 페이지. */
    public record JoinRequestsPage(List<IslandJoinRequestsPage.Item> items, String nextCursor) {
    }

    /** 강퇴 결과 {@code {removed:true}}. */
    public record Removed(boolean removed) {
    }

    /** 나가기 결과 {@code {left:true}}. */
    public record Left(boolean left) {
    }
}

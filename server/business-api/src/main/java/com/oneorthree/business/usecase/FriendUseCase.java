package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.dto.FriendItem;
import com.oneorthree.business.upstream.data.dto.FriendRequestItem;
import com.oneorthree.business.upstream.data.dto.FriendRequestState;
import com.oneorthree.business.upstream.data.dto.FriendSearchItem;
import com.oneorthree.business.upstream.data.dto.FriendshipDeleted;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 친구 8종의 위임 (GROMO-1894 7종 + GROMO-1996 검색). 판정은 전부 Data 의
 * {@code FriendService} 가 한다 — Business 는 주체를 AT 에서만 꺼내 전달하고 도메인 실패를 공개 오류 표로 옮긴다.
 *
 * <p>LLD 표의 에러 「코드」({@code SELF_REQUEST}·{@code ALREADY_FRIEND} …)는 Data 의 {@code FriendErrorCode}
 * 이름이고, 공개 표면의 코드는 api-platform policy 의 고정 표({@link ApiErrorCode})다. 그래서 여기서
 * (상태, 코드) 쌍이 정확히 맞을 때만 옮기고 원인 구분은 {@code field} 로 남긴다 — 등록되지 않은 판정은
 * 그대로 올려 502 가 되게 둔다(GROMO-1764·1759 선례).
 */
@Service
@RequiredArgsConstructor
public class FriendUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("SELF_REQUEST", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "targetUserId")),
            Map.entry("TARGET_USER_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "targetUserId")),
            Map.entry("USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("ALREADY_FRIEND", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "targetUserId")),
            Map.entry("REQUEST_ALREADY_EXISTS", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "targetUserId")),
            // 동시에 같은 상대에게 두 번 보내면 한쪽은 unique(from,to) 에 걸린다 — 재시도가 아니라 상태 충돌이다.
            Map.entry("DATA_INTEGRITY_VIOLATION", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "targetUserId")),
            Map.entry("INVALID_REQUEST_STATUS", new PublicFailure(ApiErrorCode.STATE_CONFLICT, "requestId")),
            Map.entry("NOT_REQUEST_RECEIVER", new PublicFailure(ApiErrorCode.FORBIDDEN, "requestId")),
            Map.entry("NOT_REQUEST_SENDER", new PublicFailure(ApiErrorCode.FORBIDDEN, "requestId")),
            Map.entry("REQUEST_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "requestId")),
            Map.entry("NOT_FRIEND", new PublicFailure(ApiErrorCode.NOT_FOUND, "friendUserId")),
            // GROMO-1996 검색: 등록되지 않은 검색 수단. 공개 field 는 앱이 고칠 파라미터 이름이다.
            Map.entry("INVALID_SEARCH_TYPE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "type")),
            // Data 가 400 으로 되돌리는 입력은 GET /friends 의 date 형식뿐이다 — UUID·필수 파라미터는 여기서 먼저 거른다.
            Map.entry("INVALID_PARAMETER", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "date")));

    private static final String PENDING = "PENDING";
    private static final String ACCEPTED = "ACCEPTED";
    private static final String REJECTED = "REJECTED";
    private static final String CANCELED = "CANCELED";

    private final DataFriendClient data;

    /** 친구 목록 (LLD §1.5). 빈 목록은 {@code []} 이고, 봉투가 아예 없는 것은 계약 불일치다. */
    public List<FriendView> friends(AccessTokenClaims claims, String date, Deadline deadline) {
        List<FriendItem> items = relay(() -> data.fetchFriends(claims.userId(), date, deadline));
        if (items == null) {
            throw new UpstreamContractMismatchException("친구 목록 응답이 없습니다");
        }
        return items.stream().map(FriendView::from).toList();
    }

    /** 받은·보낸 요청 목록 (LLD §1.6). */
    public List<RequestView> friendRequests(AccessTokenClaims claims, String type, Deadline deadline) {
        List<FriendRequestItem> items = relay(() -> data.fetchFriendRequests(claims.userId(), type, deadline));
        if (items == null) {
            throw new UpstreamContractMismatchException("친구 요청 목록 응답이 없습니다");
        }
        return items.stream().map(RequestView::from).toList();
    }

    /**
     * 친구 검색 (GROMO-1996, policy-2026-09-14 「친구 검색은 대소문자를 구분하지 않고 정확히 일치할
     * 때만 결과를 보여 주며 본인과 탈퇴한 사용자는 제외한다」).
     *
     * <p>결과가 없을 때는 <b>빈 배열</b>이지 404 가 아니다 — 「그런 사람이 없다」는 정상 응답이다.
     * 봉투가 아예 없는 것만 계약 불일치다.
     *
     * <p>비친구의 {@code tierLevel}·{@code occupation} 가리기는 Data 가 한다 — 여기서 한 번 더 가리면
     * 두 곳의 판정이 갈린다(게이트 정책을 Data 안에만 두는 {@code LetterUseCase} 와 같은 결).
     */
    public List<SearchView> search(AccessTokenClaims claims, String type, String query, Deadline deadline) {
        List<FriendSearchItem> items = relay(() -> data.searchFriends(claims.userId(), type, query, deadline));
        if (items == null) {
            throw new UpstreamContractMismatchException("친구 검색 응답이 없습니다");
        }
        return items.stream().map(SearchView::from).toList();
    }

    /** 친구 요청 생성 (LLD §1.1). */
    public void createRequest(AccessTokenClaims claims, UUID targetUserId, Deadline deadline) {
        expect(relay(() -> data.createFriendRequest(claims.userId(), targetUserId, deadline)), PENDING);
    }

    /** 요청 수락 (LLD §1.2). */
    public void accept(AccessTokenClaims claims, UUID requestId, Deadline deadline) {
        expect(relay(() -> data.acceptFriendRequest(claims.userId(), requestId, deadline)), ACCEPTED);
    }

    /** 요청 거절 (LLD §1.3). */
    public void reject(AccessTokenClaims claims, UUID requestId, Deadline deadline) {
        expect(relay(() -> data.rejectFriendRequest(claims.userId(), requestId, deadline)), REJECTED);
    }

    /** 요청 취소 (LLD §1.11). */
    public void cancel(AccessTokenClaims claims, UUID requestId, Deadline deadline) {
        expect(relay(() -> data.cancelFriendRequest(claims.userId(), requestId, deadline)), CANCELED);
    }

    /** 친구 삭제 (LLD §1.4). */
    public void deleteFriend(AccessTokenClaims claims, UUID friendUserId, Deadline deadline) {
        FriendshipDeleted deleted = relay(() -> data.deleteFriend(claims.userId(), friendUserId, deadline));
        if (deleted == null) {
            throw new UpstreamContractMismatchException("친구 삭제 응답이 없습니다");
        }
    }

    /** 상류가 명령 뒤 상태까지 돌려준 것을 확인한다 — 다른 상태면 배선이 어긋난 것이지 사용자 오류가 아니다. */
    private static void expect(FriendRequestState state, String status) {
        if (state == null || !status.equals(state.status())) {
            throw new UpstreamContractMismatchException("친구 요청 명령 응답이 계약과 다릅니다");
        }
    }

    /** 친구 공개 계약. 불리언 키와 nullable 프로필을 내부 DTO와 독립적으로 유지한다. */
    public record FriendView(
            @JsonProperty(required = true) UUID userId,
            String nickname,
            Integer tierLevel,
            String occupation,
            @JsonProperty(value = "isPinned", required = true) boolean isPinned,
            @JsonProperty(value = "isFocusing", required = true) boolean isFocusing,
            @JsonProperty(required = true) int focusTimeMinutes,
            String focusStartedAt,
            String focusTagName,
            String mainIslandName) {
        private static FriendView from(FriendItem source) {
            return source == null ? null : new FriendView(source.userId(), source.nickname(), source.tierLevel(),
                    source.occupation(), source.isPinned(), source.isFocusing(), source.focusTimeMinutes(),
                    source.focusStartedAt(), source.focusTagName(), source.mainIslandName());
        }
    }

    public record RequestView(
            @JsonProperty(required = true) UUID requestId,
            @JsonProperty(required = true) UUID userId,
            String nickname,
            Integer tierLevel,
            @JsonProperty(required = true) String createdAt) {
        private static RequestView from(FriendRequestItem source) {
            return source == null ? null : new RequestView(source.requestId(), source.userId(), source.nickname(),
                    source.tierLevel(), source.createdAt());
        }
    }

    public record SearchView(
            @JsonProperty(required = true) UUID userId,
            @JsonProperty(required = true) String nickname,
            Integer tierLevel,
            String occupation,
            @JsonProperty(required = true) String relation) {
        private static SearchView from(FriendSearchItem source) {
            return source == null ? null : new SearchView(source.userId(), source.nickname(), source.tierLevel(),
                    source.occupation(), source.relation());
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

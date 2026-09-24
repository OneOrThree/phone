package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.BlockedUser;
import com.oneorthree.business.upstream.data.dto.FriendItem;
import com.oneorthree.business.upstream.data.dto.FriendRequestItem;
import com.oneorthree.business.upstream.data.dto.FriendRequestState;
import com.oneorthree.business.upstream.data.dto.FriendSearchItem;
import com.oneorthree.business.upstream.data.dto.FriendshipDeleted;
import com.oneorthree.business.upstream.data.dto.LetterSlice;
import com.oneorthree.business.upstream.data.dto.LetterView;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/** 친구·차단·편지 축의 Data 호출 (GROMO-1894 · GROMO-1933 · GROMO-1996 · GROMO-2002). */
public class DataFriendClient {

    // GROMO-1894 친구 7종 — 이름은 friend-letter LLD §1.15(조회 2종)와 그 아래 명령 5종.
    private static final String PATH_FRIENDS = "/internal/users/{userId}/friends";
    private static final String PATH_FRIEND = "/internal/users/{userId}/friends/{friendUserId}";
    private static final String PATH_FRIEND_REQUESTS = "/internal/users/{userId}/friend-requests";
    // GROMO-1996 친구 검색. `/friends/{id}` 와 세그먼트가 겹치지 않게 별도 이름을 쓴다(`island-search` 선례).
    private static final String PATH_FRIEND_SEARCH = "/internal/users/{userId}/friend-search";
    private static final String PATH_BLOCKS = "/internal/users/{userId}/blocks";
    private static final String PATH_BLOCK = "/internal/users/{userId}/blocks/{blockedUserId}";
    private static final String PATH_FRIEND_REQUEST_ACCEPT =
            "/internal/users/{userId}/friend-requests/{requestId}/accept";
    private static final String PATH_FRIEND_REQUEST_REJECT =
            "/internal/users/{userId}/friend-requests/{requestId}/reject";
    private static final String PATH_FRIEND_REQUEST_CANCEL =
            "/internal/users/{userId}/friend-requests/{requestId}/cancel";
    // GROMO-1933 편지 3종 — friend-letter LLD §1.12~1.15.
    private static final String PATH_LETTERS = "/internal/users/{userId}/letters";
    private static final String PATH_LETTER = "/internal/users/{userId}/letters/{letterId}";

    private final InternalHttpClient http;

    public DataFriendClient(InternalHttpClient http) {
        this.http = http;
    }

    // ── 친구 7종 (GROMO-1894, friend-letter LLD §1.1~1.6 · §1.11) ─────────────────────────────

    /** 친구 목록. {@code date} 의 값 판정(KST 규약)은 Data 가 한다 — 여기서 두 번 해석하지 않는다. */
    public List<FriendItem> fetchFriends(UUID userId, String date, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FRIENDS, userId))
                        .onBehalfOf(userId)
                        .query("date", date)
                        .build(),
                deadline,
                new ParameterizedTypeReference<List<FriendItem>>() { });
    }

    /** 받은·보낸 PENDING 요청 목록. 봉투 없는 배열이다 — raft 조각이 배열 길이를 센다(friend-letter HLD §3). */
    public List<FriendRequestItem> fetchFriendRequests(UUID userId, String type, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FRIEND_REQUESTS, userId))
                        .onBehalfOf(userId)
                        .query("type", type)
                        .build(),
                deadline,
                new ParameterizedTypeReference<List<FriendRequestItem>>() { });
    }

    /**
     * 친구 검색 (GROMO-1996). {@code type}·{@code q} 의 값 판정(등록된 전략인가·질의어 해석)은 Data 가
     * 한다 — 여기서 두 번 해석하지 않는다. 닉네임이 대소문자 무시로 유일하므로 결과는 0건 또는 1건이다.
     */
    public List<FriendSearchItem> searchFriends(UUID userId, String type, String query, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FRIEND_SEARCH, userId))
                        .onBehalfOf(userId)
                        .query("type", type)
                        .query("q", query)
                        .build(),
                deadline,
                new ParameterizedTypeReference<List<FriendSearchItem>>() { });
    }

    /**
     * 친구 요청 생성. <b>재시도하지 않는다</b> — 멱등키 적용표(api-platform LLD §2)에 없는 명령이라 앱 키가
     * 없고, 응답 유실 뒤의 재시도는 첫 요청이 남긴 PENDING 행에 409 로 부딪힌다. 그 409 를 앱이 보는 편이
     * 재시도가 만들 두 번째 푸시보다 낫다.
     */
    public FriendRequestState createFriendRequest(UUID userId, UUID targetUserId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_FRIEND_REQUESTS, userId))
                        .onBehalfOf(userId)
                        .body(new FriendRequestCommand(targetUserId))
                        .build(),
                deadline,
                new ParameterizedTypeReference<FriendRequestState>() { });
    }

    /** 요청 수락. ACCEPTED → ACCEPTED 가 멱등(무알림)이라 재시도해도 안전하다 — FriendService.acceptRequest 계약. */
    public FriendRequestState acceptFriendRequest(UUID userId, UUID requestId, Deadline deadline) {
        return friendRequestAction(PATH_FRIEND_REQUEST_ACCEPT, userId, requestId, true, deadline);
    }

    /** 요청 거절 — PENDING 한정이라 두 번째 시도는 409 다. 재시도하지 않는다. */
    public FriendRequestState rejectFriendRequest(UUID userId, UUID requestId, Deadline deadline) {
        return friendRequestAction(PATH_FRIEND_REQUEST_REJECT, userId, requestId, false, deadline);
    }

    /** 요청 취소 — 거절과 같은 이유로 재시도하지 않는다. */
    public FriendRequestState cancelFriendRequest(UUID userId, UUID requestId, Deadline deadline) {
        return friendRequestAction(PATH_FRIEND_REQUEST_CANCEL, userId, requestId, false, deadline);
    }

    /** 친구 삭제. 두 번째 시도는 NOT_FRIEND(404)라 재시도하지 않는다. */
    public FriendshipDeleted deleteFriend(UUID userId, UUID friendUserId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.DELETE,
                                userPath(PATH_FRIEND, userId).replace("{friendUserId}", friendUserId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<FriendshipDeleted>() { });
    }

    /** 사용자 차단은 Data의 (blocker, blocked) 유니크 관계로 멱등 처리된다. */
    public void blockUser(UUID userId, UUID blockedUserId, Deadline deadline) {
        http.execute(InternalCall.to(HttpMethod.POST, userPath(PATH_BLOCKS, userId))
                .onBehalfOf(userId).body(Map.of("blockedUserId", blockedUserId)).idempotentCommand().build(), deadline);
    }

    /** 없는 관계도 Data가 성공으로 접는 멱등 차단 해제다. */
    public void unblockUser(UUID userId, UUID blockedUserId, Deadline deadline) {
        http.execute(InternalCall.to(HttpMethod.DELETE,
                userPath(PATH_BLOCK, userId).replace("{blockedUserId}", blockedUserId.toString()))
                .onBehalfOf(userId).idempotentCommand().build(), deadline);
    }

    /** blocker 관점의 차단 목록. */
    public List<BlockedUser> fetchBlockedUsers(UUID userId, Deadline deadline) {
        return http.exchange(InternalCall.to(HttpMethod.GET, userPath(PATH_BLOCKS, userId)).onBehalfOf(userId).build(),
                deadline, new ParameterizedTypeReference<List<BlockedUser>>() { });
    }

    // ── 편지 3종 (GROMO-1933, friend-letter LLD §1.12~1.15) ─────────────────────────────

    /**
     * 편지 발송. <b>재시도하지 않는다</b> — 멱등키 적용표(api-platform LLD §2)에 없는 명령이라 앱 키가
     * 없고, 응답 유실 뒤의 재시도는 같은 편지를 두 통 만든다((sender, receiver) unique 가 없다 — 같은
     * 상대에게 여러 통이 정상이다). 한 통을 확신하지 못한 채 두 통을 만드는 것보다 실패를 보이는 편이 낫다.
     */
    public LetterView sendLetter(UUID userId, UUID receiverId, String content, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_LETTERS, userId))
                        .onBehalfOf(userId)
                        .body(new LetterSendCommand(receiverId, content))
                        .build(),
                deadline,
                new ParameterizedTypeReference<LetterView>() { });
    }

    /**
     * 편지함 목록. {@code type}·{@code size}·{@code cursor} 의 값 판정(기본값·범위·알 수 없는 type 의
     * 400)은 Data 가 한다 — 여기서 두 번 해석하지 않는다. 생략된 파라미터는 아예 싣지 않는다.
     */
    public LetterSlice fetchLetters(UUID userId, String type, String cursor, String size, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_LETTERS, userId))
                        .onBehalfOf(userId)
                        .query("type", type)
                        .query("cursor", cursor)
                        .query("size", size)
                        .build(),
                deadline,
                new ParameterizedTypeReference<LetterSlice>() { });
    }

    /**
     * 편지 상세. 수신자의 첫 조회는 {@code readAt} 을 박는 부수효과가 있지만 재조회는 같은 상태를
     * 돌려준다(조건부 UPDATE 가 최초 1회만 이긴다) — GET 이라 재시도돼도 안전하다.
     */
    public LetterView fetchLetter(UUID userId, UUID letterId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET,
                                userPath(PATH_LETTER, userId).replace("{letterId}", letterId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<LetterView>() { });
    }

    /**
     * 편지 닫기 (GROMO-2002). <b>재시도하지 않는다</b> — 두 번째 시도는 {@code LETTER_NOT_FOUND}(404)라
     * 재시도가 얻을 것이 없고, 앱은 404 를 받아도 이미 원하던 상태(사라짐)에 있다.
     */
    public void closeLetter(UUID userId, UUID letterId, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.DELETE,
                                userPath(PATH_LETTER, userId).replace("{letterId}", letterId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline);
    }

    private FriendRequestState friendRequestAction(String template, UUID userId, UUID requestId,
            boolean idempotent, Deadline deadline) {
        InternalCall.Builder call = InternalCall.to(HttpMethod.POST,
                        userPath(template, userId).replace("{requestId}", requestId.toString()))
                .onBehalfOf(userId);
        if (idempotent) {
            call.idempotentCommand();
        }
        return http.exchange(call.build(), deadline, new ParameterizedTypeReference<FriendRequestState>() { });
    }

    /** 친구 요청 생성 본문 (GROMO-1894). 보내는 쪽은 X-User-Id 로 가므로 받는 쪽만 담는다. */
    record FriendRequestCommand(UUID targetUserId) {
    }

    /** 편지 발송 본문 (GROMO-1933). 보내는 쪽은 X-User-Id 로 가므로 받는 쪽과 본문만 담는다. */
    record LetterSendCommand(UUID receiverId, String content) {
    }
}

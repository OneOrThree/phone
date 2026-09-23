package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.CurrentIsland;
import com.oneorthree.business.upstream.data.dto.InvitationResolved;
import com.oneorthree.business.upstream.data.dto.IslandCreated;
import com.oneorthree.business.upstream.data.dto.IslandDiscoverPage;
import com.oneorthree.business.upstream.data.dto.IslandFocusMembers;
import com.oneorthree.business.upstream.data.dto.IslandInvitationIssued;
import com.oneorthree.business.upstream.data.dto.IslandJoinRequestsPage;
import com.oneorthree.business.upstream.data.dto.IslandManaged;
import com.oneorthree.business.upstream.data.dto.IslandMembersPage;
import com.oneorthree.business.upstream.data.dto.IslandNotices;
import com.oneorthree.business.upstream.data.dto.IslandRestMembers;
import com.oneorthree.business.upstream.data.dto.IslandSearchPage;
import com.oneorthree.business.upstream.data.dto.IslandView;
import com.oneorthree.business.upstream.data.dto.JoinIslandResult;
import com.oneorthree.business.upstream.data.dto.JoinRequestAnswer;
import com.oneorthree.business.upstream.data.dto.JoinRequestCancel;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.data.dto.MailboxViewer;
import com.oneorthree.business.upstream.data.dto.MessageAuthors;
import com.oneorthree.business.upstream.data.dto.MessageCreatedAck;
import com.oneorthree.business.upstream.data.dto.MyIslands;
import com.oneorthree.business.upstream.data.dto.MyJoinRequestsPage;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.islandPath;
import static com.oneorthree.business.upstream.data.DataPaths.noticePath;
import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/**
 * 섬 축의 Data 호출 — 소속·탐색·가입·초대, 관리·주민, 게시판, 우체통, 방장 이전, 같이 낚시 스냅샷.
 */
public class DataIslandClient {

    private static final String PATH_MAILBOX_ACCESS = "/internal/islands/{islandId}/mailbox-access";
    private static final String PATH_MESSAGE_AUTHORS = "/internal/islands/{islandId}/message-authors";
    private static final String PATH_MESSAGE_EVENTS = "/internal/islands/{islandId}/message-events";
    // GROMO-1759 섬 소속·탐색 6종. 검색·발견이 공개 경로와 이름이 다른 이유는 사용자 축에서
    // `/islands` 를 이미 «내 섬 목록» 이 쓰기 때문이다(내부 컨트롤러 javadoc 참고).
    private static final String PATH_ISLANDS = "/internal/users/{userId}/islands";
    private static final String PATH_ISLAND_SEARCH = "/internal/users/{userId}/island-search";
    private static final String PATH_ISLAND_DISCOVERY = "/internal/users/{userId}/island-discovery";
    private static final String PATH_CURRENT_ISLAND = "/internal/users/{userId}/current-island";
    private static final String PATH_ISLAND = "/internal/islands/{islandId}";
    // GROMO-1760 섬 가입·초대 5종 — 요청 소유는 사용자 축이라 모두 /internal/users/{userId} 아래다.
    private static final String PATH_ISLAND_MEMBERSHIPS =
            "/internal/users/{userId}/islands/{islandId}/memberships";
    private static final String PATH_JOIN_REQUESTS = "/internal/users/{userId}/join-requests";
    private static final String PATH_JOIN_REQUEST =
            "/internal/users/{userId}/join-requests/{requestId}";
    private static final String PATH_INVITATION_RESOLVE =
            "/internal/users/{userId}/invitations/resolve";
    private static final String PATH_ISLAND_INVITATIONS =
            "/internal/users/{userId}/islands/{islandId}/invitations";
    // GROMO-1771 섬 게시판 6종
    private static final String PATH_NOTICES = "/internal/islands/{islandId}/notices";
    private static final String PATH_NOTICE = "/internal/islands/{islandId}/notices/{noticeId}";
    private static final String PATH_NOTICE_COMMENTS = "/internal/islands/{islandId}/notices/{noticeId}/comments";
    // GROMO-1765 같이 낚시 초기 스냅샷 2종 — 공개 경로와 이름이 같다.
    private static final String PATH_FOCUS_MEMBERS = "/internal/islands/{islandId}/focus-members";
    private static final String PATH_REST_MEMBERS = "/internal/islands/{islandId}/rest-members";
    // GROMO-1802 섬 관리·주민 6종 — 섬 자원은 `/internal` + 공개 경로, 본인 나가기만 사용자 축(B26).
    private static final String PATH_ISLAND_MEMBERS = "/internal/islands/{islandId}/members";
    private static final String PATH_ISLAND_MEMBER = "/internal/islands/{islandId}/members/{targetUserId}";
    private static final String PATH_ISLAND_JOIN_REQUESTS = "/internal/islands/{islandId}/join-requests";
    private static final String PATH_ISLAND_JOIN_REQUEST = "/internal/islands/{islandId}/join-requests/{requestId}";
    private static final String PATH_ISLAND_MEMBERSHIP = "/internal/users/{userId}/islands/{islandId}/membership";

    private final InternalHttpClient http;

    public DataIslandClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 우체통 주민·시설 인가 + 요청자 표시 projection (GROMO-1775). 멱등 GET 이라 재시도한다. 거절은 Data 의
     * 도메인 코드(MEMBER_ONLY·MAILBOX_LOCKED·USER_NOT_FOUND)로 오고 유스케이스가 공개 코드로 옮긴다.
     */
    public MailboxViewer mailboxAccess(UUID islandId, UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_MAILBOX_ACCESS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<MailboxViewer>() { });
    }

    /**
     * 한 페이지 작성자들의 표시 projection — «방금 읽은 페이지의 sender 집합»만 넘긴다(LLD §5). POST 지만
     * 상태를 바꾸지 않는 조회라 재시도해도 안전하다. id 를 쿼리에 싣지 않는 것은 100개까지 늘어나서다.
     */
    public MessageAuthors messageAuthors(UUID islandId, UUID userId, List<UUID> authorIds, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_MESSAGE_AUTHORS, islandId))
                        .onBehalfOf(userId)
                        .body(Map.of("userIds", authorIds))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<MessageAuthors>() { });
    }

    /**
     * {@code message.created} 를 Data outbox 에 적는다 — 실시간 저장이 «처음» 성공한 뒤에만 부른다. eventId 가
     * messageId 로 결정되므로 재시도는 같은 봉투를 재생한다 → 멱등 명령이다. 두 서비스 사이의 원자성과 실패 시
     * 동작은 {@code IslandMailboxUseCase#send} 에 적혀 있다.
     */
    public MessageCreatedAck recordMessageCreated(UUID islandId, UUID authorId, UUID messageId,
            UUID clientMessageId, Instant sentAt, Deadline deadline) {
        // 본문은 싣지 않는다 — M02(메시지 정본은 gromo_chat). 소비자는 messageId 로 자기 DB 에서 읽는다.
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_MESSAGE_EVENTS, islandId))
                        .onBehalfOf(authorId)
                        .body(Map.of("messageId", messageId.toString(), "clientMessageId", clientMessageId.toString(),
                                "sentAt", sentAt.toString()))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<MessageCreatedAck>() { });
    }

    /** 같은 앱 UUID 키로 원 Data receipt를 재생한다. 사용자/세션은 서명된 AT에서만 가져온다. */
    public JsonNode transferIslandHost(UUID userId, UUID sessionId, long generation, UUID islandId,
            UUID targetUserId, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/islands/" + islandId + "/host-transfer")
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(Map.of("sessionId", sessionId, "authGeneration", generation,
                                "targetUserId", targetUserId))
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

    /** 섬 생성 (GROMO-1759, LLD §3.1). 생성자가 방장이 되고 현재 섬이 새 섬으로 옮겨진다. */
    public IslandCreated createIsland(UUID userId, String name, String intro, boolean approvalRequired,
            Integer maxMembers, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_ISLANDS, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new CreateIslandCommand(name, intro, approvalRequired, maxMembers))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandCreated>() { });
    }

    /** 내 섬 목록 (GROMO-1759, LLD §3.5). */
    public MyIslands fetchMyIslands(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_ISLANDS, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<MyIslands>() { });
    }

    /**
     * 섬 이름 검색 한 페이지 (GROMO-1759, LLD §3.2).
     *
     * <p>{@code cursorIslandId} 는 <b>서명을 이미 검증한</b> keyset 경계다 — 앱이 준 토큰이 아니라
     * {@code SignedCursorCodec} 이 열어 준 값만 여기까지 온다.
     */
    public IslandSearchPage searchIslands(UUID userId, String q, UUID cursorIslandId, int limit,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_ISLAND_SEARCH, userId))
                        .onBehalfOf(userId)
                        .query("q", q)
                        .query("cursorIslandId", cursorIslandId == null ? null : cursorIslandId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandSearchPage>() { });
    }

    /** 첫 소속 탐색 한 페이지 (GROMO-1759, LLD §3.3). seed 가 한 탐색 세션의 순서를 고정한다. */
    public IslandDiscoverPage discoverIslands(UUID userId, String seed, String afterHandle, int limit,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_ISLAND_DISCOVERY, userId))
                        .onBehalfOf(userId)
                        .query("seed", seed)
                        .query("afterHandle", afterHandle)
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandDiscoverPage>() { });
    }

    /** 현재 섬 이동 (GROMO-1759, LLD §3.6). 같은 섬이면 상류가 상태확인으로 처리한다. */
    public CurrentIsland switchCurrentIsland(UUID userId, UUID islandId, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT, userPath(PATH_CURRENT_ISLAND, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new SwitchCurrentIslandCommand(islandId))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<CurrentIsland>() { });
    }

    /**
     * 섬 하나 (GROMO-1759, LLD §3.4).
     *
     * <p>주체는 {@code onBehalfOf} 로만 전달한다 — 범위(주민/방문자) 판정은 전적으로 상류의 DB
     * 상태이고 이 호출에는 역할·소속을 암시하는 파라미터가 없다.
     */
    public IslandView fetchIsland(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandView>() { });
    }

    /**
     * 섬 가입 (GROMO-1760, LLD §3.7). 즉시 가입이면 {@code active}+새 current, 승인제면
     * {@code pending} 요청을 만든다 — 판정은 전부 상류 몫이고 결과는 receipt 로 재생된다.
     */
    public JoinIslandResult joinIsland(UUID userId, UUID islandId, String invitationToken,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                userPath(PATH_ISLAND_MEMBERSHIPS, userId)
                                        .replace("{islandId}", islandId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new JoinIslandCommand(invitationToken))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JoinIslandResult>() { });
    }

    /**
     * 내 가입 신청 목록 한 페이지 (GROMO-2047, LLD §3.12). 경계는 Business 가 서명 커서에서 꺼낸
     * 평문이고, 소유는 상류가 {@code applicant_id} 로 묶어 찾는다 — 남의 요청은 후보조차 아니다.
     */
    public MyJoinRequestsPage fetchMyJoinRequests(UUID userId, Instant afterCreatedAt,
            UUID afterRequestId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_JOIN_REQUESTS, userId))
                        .onBehalfOf(userId)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterRequestId", afterRequestId == null ? null : afterRequestId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<MyJoinRequestsPage>() { });
    }

    /**
     * 가입 요청 상태 (GROMO-1760, LLD §3.8). 멱등 GET 이라 재시도한다. 본인 소유 판정은
     * 상류의 {@code id+applicantId} 조회가 하고, 남의 요청은 404 로 접힌다.
     */
    public JoinRequestStatus fetchJoinRequest(UUID userId, UUID requestId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET,
                                userPath(PATH_JOIN_REQUEST, userId)
                                        .replace("{requestId}", requestId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<JoinRequestStatus>() { });
    }

    /**
     * 가입 요청 취소 (GROMO-1760, LLD §3.9). 본인의 {@code pending} 만 종결되고 terminal 요청은
     * 상류가 409 로 거절한다 — 재시도하지 않는다.
     */
    public JoinRequestCancel cancelJoinRequest(UUID userId, UUID requestId, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.DELETE,
                                userPath(PATH_JOIN_REQUEST, userId)
                                        .replace("{requestId}", requestId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JoinRequestCancel>() { });
    }

    /**
     * 초대 코드 해석 (GROMO-1760, LLD §3.10). 조회 성격이라 멱등키를 싣지 않고 재시도한다.
     * code 의 형식/폐기 판정(422/410)은 상류가 한다 — 여기서 미리 걸러 4xx 의미를 갉아먹지 않는다.
     */
    public InvitationResolved resolveInvitation(UUID userId, String code, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_INVITATION_RESOLVE, userId))
                        .onBehalfOf(userId)
                        .body(new InvitationResolveCommand(code))
                        .build(),
                deadline,
                new ParameterizedTypeReference<InvitationResolved>() { });
    }

    /**
     * 섬 초대 발급 (GROMO-1760, LLD §3.11). inviter 당 활성 코드 재사용·세대 변경 시 재발급은
     * 상류 수명주기이고 같은 키 재생은 저장 결과를 돌려준다.
     */
    public IslandInvitationIssued issueIslandInvitation(UUID userId, UUID islandId, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                userPath(PATH_ISLAND_INVITATIONS, userId)
                                        .replace("{islandId}", islandId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandInvitationIssued>() { });
    }

    /**
     * 게시판 목록 (GROMO-1771). anchor 두 값은 서명 커서를 푼 이전 페이지의 마지막 행이다 — 첫 페이지는 싣지 않는다.
     * 주민·게시판 완공 판정은 Data 가 한다. 멱등 GET 이라 재시도한다.
     */
    public IslandNotices.Page fetchNotices(UUID userId, UUID islandId, Instant afterCreatedAt, UUID afterId,
            int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_NOTICES, islandId))
                        .onBehalfOf(userId)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterId", afterId == null ? null : afterId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandNotices.Page>() { });
    }

    /** 공지 상세 + 댓글 한 페이지 (GROMO-1771). 댓글 anchor 는 {@code commentsCursor} 를 푼 값이다. */
    public IslandNotices.Detail fetchNotice(UUID userId, UUID islandId, UUID noticeId,
            Instant commentsAfterCreatedAt, UUID commentsAfterId, int commentsLimit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, noticePath(PATH_NOTICE, islandId, noticeId))
                        .onBehalfOf(userId)
                        .query("commentsAfterCreatedAt",
                                commentsAfterCreatedAt == null ? null : commentsAfterCreatedAt.toString())
                        .query("commentsAfterId", commentsAfterId == null ? null : commentsAfterId.toString())
                        .query("commentsLimit", Integer.toString(commentsLimit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandNotices.Detail>() { });
    }

    /** 공지 작성 (GROMO-1771). 응답 유실 복구는 같은 앱 키의 Data receipt 재생이다. */
    public IslandNotices.Notice createNotice(UUID userId, UUID islandId, String title, String body, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_NOTICES, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new NoticeCreateCommand(title, body))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandNotices.Notice>() { });
    }

    /**
     * 공지 수정 (GROMO-1771). 생략한 필드는 본문에 싣지 않는다 — Data 가 «생략 = 유지»로 읽고, 지문도 보낸
     * 필드만 담는다(정책 B06). null 값을 싣지 않으려고 Map 으로 보낸다.
     */
    public IslandNotices.Notice updateNotice(UUID userId, UUID islandId, UUID noticeId, String title, String body,
            UUID key, Deadline deadline) {
        Map<String, String> fields = new LinkedHashMap<>();
        if (title != null) {
            fields.put("title", title);
        }
        if (body != null) {
            fields.put("body", body);
        }
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, noticePath(PATH_NOTICE, islandId, noticeId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(fields)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandNotices.Notice>() { });
    }

    /** 공지 삭제 (GROMO-1771). 같은 키 재전송은 공지가 이미 없어도 원 결과(deleted=true)다. */
    public IslandNotices.Deleted deleteNotice(UUID userId, UUID islandId, UUID noticeId, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.DELETE, noticePath(PATH_NOTICE, islandId, noticeId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandNotices.Deleted>() { });
    }

    /** 댓글 작성 (GROMO-1771). 작성자는 onBehalfOf 주체뿐이다 — 본문에 사용자 id 를 싣지 않는다. */
    public IslandNotices.CommentCreated createNoticeComment(UUID userId, UUID islandId, UUID noticeId, String text,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, noticePath(PATH_NOTICE_COMMENTS, islandId, noticeId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new NoticeCommentCommand(text))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandNotices.CommentCreated>() { });
    }

    /** 집중 주민 스냅샷 (GROMO-1765). 멱등 GET 이라 재시도한다. 소속 판정은 상류 몫이다. */
    public IslandFocusMembers fetchFocusMembers(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_FOCUS_MEMBERS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandFocusMembers>() { });
    }

    /** 휴식 주민 스냅샷 (GROMO-1765). 멱등 GET 이라 재시도한다. */
    public IslandRestMembers fetchRestMembers(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_REST_MEMBERS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRestMembers>() { });
    }

    /**
     * 섬 정보 수정 (GROMO-1802, 섬 관리 LLD §3.1). 본문은 앱이 보낸 필드만 담는다 — 키 부재가 «미변경» 이라
     * null 로 채워내면 상류가 명시 null 로 읽고 거절한다.
     */
    public IslandManaged manageIsland(UUID userId, UUID islandId, Map<String, Object> fields, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, islandPath(PATH_ISLAND, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(fields)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandManaged>() { });
    }

    /** 주민 목록 한 페이지 (GROMO-1802, 섬 관리 LLD §3.2). 경계는 Business 가 서명 커서에서 꺼낸 평문이다. */
    public IslandMembersPage fetchIslandMembers(UUID userId, UUID islandId, Instant afterJoinedAt,
            UUID afterMembershipId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_MEMBERS, islandId))
                        .onBehalfOf(userId)
                        .query("afterJoinedAt", afterJoinedAt == null ? null : afterJoinedAt.toString())
                        .query("afterMembershipId", afterMembershipId == null ? null : afterMembershipId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandMembersPage>() { });
    }

    /** 신청자 목록 한 페이지 (GROMO-1802, 섬 관리 LLD §3.3). 방장 판정은 상류가 한다. */
    public IslandJoinRequestsPage fetchIslandJoinRequests(UUID userId, UUID islandId, Instant afterCreatedAt,
            UUID afterRequestId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_JOIN_REQUESTS, islandId))
                        .onBehalfOf(userId)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterRequestId", afterRequestId == null ? null : afterRequestId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandJoinRequestsPage>() { });
    }

    /** 가입 요청 승인·거절 (GROMO-1802, 섬 관리 LLD §3.4). 같은 키는 상류 receipt 가 재생한다. */
    public JoinRequestAnswer answerJoinRequest(UUID userId, UUID islandId, UUID requestId, String decision,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, islandPath(PATH_ISLAND_JOIN_REQUEST, islandId)
                                .replace("{requestId}", requestId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(Map.of("decision", decision))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JoinRequestAnswer>() { });
    }

    /** 주민 강퇴 (GROMO-1802, 섬 관리 LLD §3.6). */
    public JsonNode kickIslandMember(UUID userId, UUID islandId, UUID targetUserId, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.DELETE, islandPath(PATH_ISLAND_MEMBER, islandId)
                                .replace("{targetUserId}", targetUserId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JsonNode>() { });
    }

    /** 본인 나가기 (GROMO-1802, 섬 관리 LLD §3.7) — 사용자 축 경로다. */
    public JsonNode leaveIsland(UUID userId, UUID islandId, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.DELETE, islandPath(userPath(PATH_ISLAND_MEMBERSHIP, userId), islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JsonNode>() { });
    }

    /**
     * 섬 생성 요청 본문 (GROMO-1759 · GROMO-1993). {@code password} 는 여전히 client 가 넣지 못한다.
     * {@code maxMembers} 는 정책 「섬 생성 시 방장이 … 정원을 설정한다」로 열렸고, null 이면 Data 가
     * 기본값(15)을 채운다.
     */
    record CreateIslandCommand(String name, String intro, boolean approvalRequired, Integer maxMembers) {
    }

    /** 현재 섬 이동 요청 본문 (GROMO-1759). */
    record SwitchCurrentIslandCommand(UUID islandId) {
    }

    /** 섬 가입 요청 본문 (GROMO-1760). {@code invitationToken} 은 없으면 null 그대로다. */
    record JoinIslandCommand(String invitationToken) {
    }

    /** 초대 코드 해석 요청 본문 (GROMO-1760). */
    record InvitationResolveCommand(String code) {
    }

    /** 공지 작성 본문 (GROMO-1771). 작성자는 X-User-Id 로 간다. */
    record NoticeCreateCommand(String title, String body) {
    }

    /** 댓글 작성 본문 (GROMO-1771). */
    record NoticeCommentCommand(String text) {
    }
}

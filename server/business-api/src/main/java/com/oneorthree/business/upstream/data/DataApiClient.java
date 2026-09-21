package com.oneorthree.business.upstream.data;

import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.AccountMe;
import com.oneorthree.business.upstream.data.dto.AccountProfile;
import com.oneorthree.business.upstream.data.dto.ClaimIntentLease;
import com.oneorthree.business.upstream.data.dto.ClaimIntentPage;
import com.oneorthree.business.upstream.data.dto.ConstructionOptions;
import com.oneorthree.business.upstream.data.dto.ConstructionResult;
import com.oneorthree.business.upstream.data.dto.ConstructionTarget;
import com.oneorthree.business.upstream.data.dto.IslandAppearancePatchResult;
import com.oneorthree.business.upstream.data.dto.IslandQuestViews;
import com.oneorthree.business.upstream.data.dto.IslandRankingViews;
import com.oneorthree.business.upstream.data.dto.IslandRecordViews;
import com.oneorthree.business.upstream.data.dto.PersonalAppearancePatchResult;
import com.oneorthree.business.upstream.data.dto.PersonalInventory;
import com.oneorthree.business.upstream.data.dto.PlaybackPatchResult;
import com.oneorthree.business.upstream.data.dto.PlaybackState;
import com.oneorthree.business.upstream.data.dto.SharedInventory;
import com.oneorthree.business.upstream.data.dto.ShopViews;
import com.oneorthree.business.upstream.data.dto.DeviceSessionCheck;
import com.oneorthree.business.upstream.data.dto.ClaimIntentAck;
import com.oneorthree.business.upstream.data.dto.CurrentFocusSession;
import com.oneorthree.business.upstream.data.dto.CurrentIsland;
import com.oneorthree.business.upstream.data.dto.IslandCreated;
import com.oneorthree.business.upstream.data.dto.IslandDiscoverPage;
import com.oneorthree.business.upstream.data.dto.IslandInvitationIssued;
import com.oneorthree.business.upstream.data.dto.IslandJoinRequestsPage;
import com.oneorthree.business.upstream.data.dto.IslandLedger;
import com.oneorthree.business.upstream.data.dto.IslandManaged;
import com.oneorthree.business.upstream.data.dto.IslandMembersPage;
import com.oneorthree.business.upstream.data.dto.IslandNotices;
import com.oneorthree.business.upstream.data.dto.IslandSearchPage;
import com.oneorthree.business.upstream.data.dto.IslandView;
import com.oneorthree.business.upstream.data.dto.MyIslands;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.data.dto.FocusFinish;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.FocusSummary;
import com.oneorthree.business.upstream.data.dto.IslandFocusMembers;
import com.oneorthree.business.upstream.data.dto.IslandRestMembers;
import com.oneorthree.business.upstream.data.dto.FrozenClickCandidate;
import com.oneorthree.business.upstream.data.dto.InviteIssueContext;
import com.oneorthree.business.upstream.data.dto.InvitationResolved;
import com.oneorthree.business.upstream.data.dto.JoinIslandResult;
import com.oneorthree.business.upstream.data.dto.JoinRequestAnswer;
import com.oneorthree.business.upstream.data.dto.JoinRequestCancel;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.data.dto.MailboxViewer;
import com.oneorthree.business.upstream.data.dto.MessageAuthors;
import com.oneorthree.business.upstream.data.dto.MessageCreatedAck;
import com.oneorthree.business.upstream.data.dto.LoginAttemptLookup;
import com.oneorthree.business.upstream.data.dto.LoginSession;
import com.oneorthree.business.upstream.data.dto.SessionRefresh;
import com.oneorthree.business.upstream.data.dto.UserActivation;
import com.oneorthree.business.upstream.data.dto.FriendItem;
import com.oneorthree.business.upstream.data.dto.FriendRequestItem;
import com.oneorthree.business.upstream.data.dto.FriendRequestState;
import com.oneorthree.business.upstream.data.dto.FriendshipDeleted;
import com.oneorthree.business.upstream.data.dto.LetterSlice;
import com.oneorthree.business.upstream.data.dto.LetterView;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Data API 로 나가는 유일한 창구. 경로가 <b>여기 상수로만</b> 존재하므로 임의 URL 프록시가 불가능하다.
 *
 * <h2>⚠️ 이 표면은 Data 쪽에 아직 없다</h2>
 * 최신 main({@code 69d05f873})의 {@code server/data-api} 에는 {@code /internal/*} 컨트롤러가
 * <b>한 건도 없다</b>(실제 확인: {@code grep -rn "/internal" server/data-api/src/main/java} → 0건).
 * 여기 적힌 경로·스키마는 {@code docs/contracts/business-satellite-api.yaml} 로 제안한 계약이고,
 * <b>Data 구현이 붙기 전에는 이 클라이언트가 런타임에 404 를 받는다</b> — 그 404 는 도메인 코드가 없어
 * {@code UpstreamContractMismatchException}(502)으로 올라간다. 테스트의 mock 성공이 이 사실을
 * 감추지 않도록, mock 은 «계약대로 응답하는 상류»를 세우는 데만 쓴다.
 */
public class DataApiClient {

    private static final String PATH_ACTIVATION = "/internal/users/{userId}/activation";
    private static final String PATH_DEVICE_SESSION_VERIFY = "/internal/auth/device-sessions/verify";
    private static final String PATH_SESSION_VERIFY = "/internal/auth/sessions/verify";
    private static final String PATH_LOGIN_ATTEMPTS = "/internal/auth/login-attempts";
    private static final String PATH_LOGIN_ATTEMPT_LOOKUP = "/internal/auth/login-attempts/lookup";
    private static final String PATH_DEVICE_TOKEN_DELETIONS = "/internal/users/{userId}/device-token-deletions";
    private static final String PATH_NOTIFICATION_SETTINGS_COMMANDS =
            "/internal/users/{userId}/notification-settings-commands";
    private static final String PATH_COMMAND_DELIVERED = "/internal/outbox-commands/{commandId}/delivered";
    private static final String PATH_INVITE_ISSUE_CONTEXT = "/internal/groups/{groupId}/invite-issue-context";
    private static final String PATH_CLAIM_INTENTS = "/internal/invite-links/claim-intents";
    private static final String PATH_CLAIM_CONFIRMATIONS = "/internal/invite-links/claim-confirmations";
    private static final String PATH_RESULT_CLAIM = "/internal/users/{userId}/challenge-results/{sessionId}/claim";
    private static final String PATH_RESULT_ACK = "/internal/users/{userId}/challenge-results/{sessionId}/ack";
    private static final String PATH_CLAIM_INTENTS_PENDING = "/internal/invite-links/claim-intents";
    private static final String PATH_CLAIM_INTENT_LEASE =
            "/internal/invite-links/claim-intents/{commandId}/lease";
    private static final String PATH_CLAIM_INTENT_COMPLETED =
            "/internal/invite-links/claim-intents/{commandId}/completed";
    private static final String PATH_CLAIM_INTENT_ABANDONED =
            "/internal/invite-links/claim-intents/{commandId}/abandoned";
    private static final String PATH_FROZEN_CANDIDATES =
            "/internal/migrations/{migrationId}/invite-link-clicks/candidates";
    private static final String PATH_FOCUS_SESSIONS = "/internal/users/{userId}/focus-sessions";
    private static final String PATH_FOCUS_SESSION_CURRENT = "/internal/users/{userId}/focus-sessions/current";
    private static final String PATH_FOCUS_SESSION_PAUSE =
            "/internal/users/{userId}/focus-sessions/{sessionId}/pause";
    private static final String PATH_FOCUS_SESSION_RESUME =
            "/internal/users/{userId}/focus-sessions/{sessionId}/resume";
    private static final String PATH_FOCUS_SESSION_FINISH =
            "/internal/users/{userId}/focus-sessions/{sessionId}/finish";
    private static final String PATH_FOCUS_SUMMARY = "/internal/users/{userId}/focus-summary";
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
    private static final String PATH_JOIN_REQUEST =
            "/internal/users/{userId}/join-requests/{requestId}";
    private static final String PATH_INVITATION_RESOLVE =
            "/internal/users/{userId}/invitations/resolve";
    private static final String PATH_ISLAND_INVITATIONS =
            "/internal/users/{userId}/islands/{islandId}/invitations";
    // GROMO-1894 친구 7종 — 이름은 friend-letter LLD §1.15(조회 2종)와 그 아래 명령 5종.
    private static final String PATH_FRIENDS = "/internal/users/{userId}/friends";
    private static final String PATH_FRIEND = "/internal/users/{userId}/friends/{friendUserId}";
    private static final String PATH_FRIEND_REQUESTS = "/internal/users/{userId}/friend-requests";
    private static final String PATH_FRIEND_REQUEST_ACCEPT =
            "/internal/users/{userId}/friend-requests/{requestId}/accept";
    private static final String PATH_FRIEND_REQUEST_REJECT =
            "/internal/users/{userId}/friend-requests/{requestId}/reject";
    private static final String PATH_FRIEND_REQUEST_CANCEL =
            "/internal/users/{userId}/friend-requests/{requestId}/cancel";
    // GROMO-1933 편지 3종 — friend-letter LLD §1.12~1.15.
    private static final String PATH_LETTERS = "/internal/users/{userId}/letters";
    private static final String PATH_LETTER = "/internal/users/{userId}/letters/{letterId}";
    // GROMO-1767 섬 건설 3종 — 공개 경로와 이름이 같다. 내부 계약 전체가 이 seam 에만 있다.
    private static final String PATH_CONSTRUCTION_OPTIONS = "/internal/islands/{islandId}/construction-options";
    private static final String PATH_CONSTRUCTION_TARGET = "/internal/islands/{islandId}/construction-target";
    private static final String PATH_CONSTRUCTIONS = "/internal/islands/{islandId}/constructions";
    // GROMO-1771 섬 게시판 6종
    private static final String PATH_NOTICES = "/internal/islands/{islandId}/notices";
    private static final String PATH_NOTICE = "/internal/islands/{islandId}/notices/{noticeId}";
    private static final String PATH_NOTICE_COMMENTS = "/internal/islands/{islandId}/notices/{noticeId}/comments";
    // GROMO-1801 계정 3종 — B26 사용자 축. 세션 증명(sid·gen)은 서명된 AT 에서 꺼낸 값을 헤더로 싣는다.
    private static final String PATH_ACCOUNT = "/internal/users/{userId}";
    private static final String HEADER_SESSION = "X-Session-Id";
    private static final String HEADER_GENERATION = "X-Auth-Generation";
    // GROMO-1765 같이 낚시 초기 스냅샷 2종 — 공개 경로와 이름이 같다.
    private static final String PATH_FOCUS_MEMBERS = "/internal/islands/{islandId}/focus-members";
    private static final String PATH_REST_MEMBERS = "/internal/islands/{islandId}/rest-members";
    // GROMO-1783 보유품·외양 4종 — 개인 축은 /internal/users/{userId}, 섬 축은 /internal/islands/{islandId}.
    private static final String PATH_MY_INVENTORY = "/internal/users/{userId}/inventory";
    private static final String PATH_MY_APPEARANCE = "/internal/users/{userId}/appearance";
    private static final String PATH_ISLAND_INVENTORY = "/internal/islands/{islandId}/inventory";
    private static final String PATH_ISLAND_APPEARANCE = "/internal/islands/{islandId}/appearance";
    private static final String PATH_ISLAND_PLAYBACK = "/internal/islands/{islandId}/playback";
    // GROMO-1781 섬 상점 5종 — 섬 축 공개 경로 그대로 `/internal` 아래다.
    private static final String PATH_SHOP_WALLETS = "/internal/islands/{islandId}/shop/wallets";
    private static final String PATH_SHOP_PRODUCTS = "/internal/islands/{islandId}/shop/products";
    private static final String PATH_SHOP_ORDERS = "/internal/islands/{islandId}/shop/orders";
    // GROMO-1802 섬 관리·주민 6종 — 섬 자원은 `/internal` + 공개 경로, 본인 나가기만 사용자 축(B26).
    private static final String PATH_ISLAND_MEMBERS = "/internal/islands/{islandId}/members";
    private static final String PATH_ISLAND_MEMBER = "/internal/islands/{islandId}/members/{targetUserId}";
    private static final String PATH_ISLAND_JOIN_REQUESTS = "/internal/islands/{islandId}/join-requests";
    private static final String PATH_ISLAND_JOIN_REQUEST = "/internal/islands/{islandId}/join-requests/{requestId}";
    private static final String PATH_ISLAND_MEMBERSHIP = "/internal/users/{userId}/islands/{islandId}/membership";
    // GROMO-1773 섬 퀘스트 5종 — 공개 경로 앞에 /internal 을 붙인 이름이다(island-quests LLD §2).
    private static final String PATH_QUESTS = "/internal/islands/{islandId}/quests";
    private static final String PATH_QUESTS_CURRENT = "/internal/islands/{islandId}/quests/current";
    // GROMO-1769 회관 기록 3종 — 조회 2 는 섬 축, 측정 PUT 은 본인 명령이라 사용자 축(B26).
    private static final String PATH_FOCUS_STATISTICS = "/internal/islands/{islandId}/statistics/focus";
    private static final String PATH_SCREEN_TIME_STATISTICS = "/internal/islands/{islandId}/statistics/screen-time";
    // GROMO-1895 섬 공동 가계부 — 회관 화면과 도메인 GET 이 같이 쓰는 섬 축 조회다(B26).
    private static final String PATH_ISLAND_LEDGER = "/internal/islands/{islandId}/resources/ledger";
    // GROMO-1997 주간 섬 랭킹 — 경로 섬이 없는 «전체 섬» 순위라 주체 축이다(B26).
    private static final String PATH_ISLAND_RANKINGS = "/internal/users/{userId}/island-rankings";

    private final InternalHttpClient http;

    public DataApiClient(InternalHttpClient http) {
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

    private static String islandPath(String template, UUID islandId) {
        return template.replace("{islandId}", islandId.toString());
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

    /**
     * 제공자 교환 <b>전</b> 내구 시도 조회 (계정 LLD §3-1 · §3-2).
     *
     * <p>{@code onBehalfOf} 가 없다 — 로그인 전에는 검증된 주체가 없다. 그게 이 요청으로 알아내려는
     * 값이다. 자격은 {@code digest} 가 증명한다.
     *
     * <p>{@code idempotentCommand()} 를 켜는 이유: 이 호출은 상태를 바꾸지 않아 재시도가 안전한데,
     * 기본 재시도 대상은 GET 뿐이라 켜 주지 않으면 일시 오류 한 번에 로그인이 실패한다.
     */
    public LoginAttemptLookup lookupLoginAttempt(UUID attemptId, String digestKeyId, String digest,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_LOGIN_ATTEMPT_LOOKUP)
                        .body(new LoginAttemptLookupCommand(attemptId, digestKeyId, digest))
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LoginAttemptLookup>() { });
    }

    /**
     * 실행권을 잡고 제공자 교환까지 수행한다 (계정 LLD §3-3).
     *
     * <p><b>{@code attemptId} 가 멱등 키다.</b> 원장이 그 키로 실행권을 선점하므로, 재시도가 같은
     * 값을 들고 오면 두 번째 교환이 일어나지 않는다. 별도 {@code Idempotency-Key} 헤더를 붙이지
     * 않는 이유는 로그인이 범용 receipt 계약 밖이기 때문이다(정책 A16 「로그인/로그아웃은 별도
     * 인증 계약이다」).
     */
    public LoginSession executeLoginAttempt(LoginAttemptCommand command, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_LOGIN_ATTEMPTS)
                        .body(command)
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LoginSession>() { });
    }

    /** 조회 요청 본문. 원 자격이 아니라 digest 만 나간다. */
    private record LoginAttemptLookupCommand(UUID attemptId, String digestKeyId, String credentialDigest) {
    }

    /**
     * 교환 요청 본문.
     *
     * <p>{@code credential}·{@code callerAccessToken} 은 자격 원문이다 — 이 DTO 는 HTTP 본문으로
     * 한 번 나갈 뿐 어디에도 보관되지 않으며, {@code toString} 은 값을 가린다(직렬화는 Jackson 이
     * 필드 접근자로 하므로 가려도 전송에는 영향이 없다).
     */
    public record LoginAttemptCommand(
            UUID attemptId, String digestKeyId, String credentialDigest, String provider,
            String credentialKind, String credential, String termsVersion, String callerAccessToken) {

        @Override
        public String toString() {
            return "LoginAttemptCommand[attemptId=" + attemptId + ", provider=" + provider
                    + ", credentialKind=" + credentialKind + ", credential=redacted]";
        }
    }

    /**
     * AT 재발급 (GROMO-2035). 주체는 Data 가 RT 서명에서 직접 확인한다 — {@code onBehalfOf} 가 없는
     * 이유도 그것이다(여기 닿는 요청은 유효한 AT 를 갖고 있지 않다).
     *
     * <p>{@code idempotentCommand()} 를 켠다: 이 경로는 회전하지 않아 상태를 바꾸지 않으므로 재시도가
     * 안전하고, 켜 주지 않으면 일시 오류 한 번에 앱이 재로그인으로 떨어진다(기본 재시도 대상은 GET 뿐).
     */
    public SessionRefresh refreshSession(String refreshToken, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/auth/sessions/refresh")
                        .body(new SessionRefreshCommand(refreshToken))
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<SessionRefresh>() { });
    }

    /**
     * 게스트 세션 발급 (GROMO-2036).
     *
     * <p><b>{@code deviceDigest} 가 멱등 키다.</b> Data 의 점유 원장이 그 값으로 복구 창을 잡으므로,
     * 유실된 201 을 재시도해도 계정이 하나 더 생기지 않는다 — {@code executeLoginAttempt} 의
     * {@code attemptId} 와 같은 자리다. 그래서 여기서도 {@code idempotentCommand()} 를 켠다.
     *
     * @param clientIp Business 가 판정한 호출자 주소. Data 의 게스트 레이트리밋 축이라 <b>반드시</b>
     *                 넘긴다 — 내부 호출의 소스 IP 를 쓰면 모든 게스트가 한 주소로 뭉쳐 한도가
     *                 「전원 차단」으로 동작한다
     */
    public LoginSession issueGuestSession(String deviceDigest, String clientIp, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/auth/guest-sessions")
                        .body(new GuestSessionCommand(deviceDigest, clientIp))
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LoginSession>() { });
    }

    /** 갱신 요청 본문. RT 원문이라 {@code toString} 이 값을 가린다. */
    private record SessionRefreshCommand(String refreshToken) {
        @Override
        public String toString() {
            return "SessionRefreshCommand[refreshToken=redacted]";
        }
    }

    /** 게스트 발급 요청 본문. 기기 식별자 «원문» 은 나가지 않는다 — digest 만 나간다. */
    private record GuestSessionCommand(String deviceDigest, String clientIp) {
    }

    /** 원 RT의 폐기 증명으로 재시도 가능한 로그아웃. 주체는 Data가 자격에서 직접 검증한다. */
    public JsonNode logoutSession(LogoutCredentials credentials, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/auth/sessions/logout")
                        .body(credentials)
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JsonNode>() { });
    }

    /**
     * 위성 쓰기 전 활성 검사 (A22 ⓖ). 멱등 GET 이라 재시도한다.
     *
     * <p><b>실패를 「비활성」으로 접지 않는다</b> — 그러면 Data 장애가 「전원 탈퇴」라는 조용한 차단이
     * 되어 설정 변경·기기 등록이 전부 막힌다. 판정 불가는 503 으로 올라간다.
     */
    public UserActivation checkActivation(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_ACTIVATION.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<UserActivation>() { });
    }

    /**
     * {@code deviceBootstrap} 세션 활성 확인 + {@code sessionEpoch} fencing (A22 ㋤ · ㋨).
     *
     * <p>POST 지만 <b>상태를 바꾸지 않는 확인</b>이라 재시도해도 안전하다. GET 이 아닌 이유는 자격
     * 문자열을 쿼리에 실으면 접근 로그·프록시 캐시에 남기 때문이다.
     */
    public DeviceSessionCheck verifyDeviceSession(UUID userId, String deviceBootstrap, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_DEVICE_SESSION_VERIFY)
                        .onBehalfOf(userId)
                        .body(Map.of("deviceBootstrap", deviceBootstrap))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DeviceSessionCheck>() { });
    }

    /**
     * 서명된 {@code sid} 로 하는 세션 활성 확인 — <b>자격을 싣지 못하는 구 앱</b> 경로(A22 ㋤).
     *
     * <p>확인만 하고 <b>자격은 받지 않는다</b>: 응답에는 활성 여부와 fencing 값만 있다. 자격을 받아
     * 등록 봉투에 실으면 저장하지도 않은 앱이 1회용 자격을 가진 것처럼 되어, 현대 앱의 소유권·CAS
     * 판정이 이 경로로 우회된다.
     *
     * @param sessionId AT 의 {@code sid} claim — 서버가 서명한 값이라 앱이 만들어낼 수 없다
     */
    public DeviceSessionCheck verifySession(UUID userId, UUID sessionId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_SESSION_VERIFY)
                        .onBehalfOf(userId)
                        .body(Map.of("sessionId", sessionId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DeviceSessionCheck>() { });
    }

    /**
     * 기기 토큰 삭제 outbox 를 <b>직접 삭제 「전에」</b> 기록한다 (A22 ㊲ · ㊿ · ㊨ · ㊪).
     *
     * <p>순서를 뒤집으면(실패 후에야 기록) 그 사이 프로세스가 죽을 때 직접 삭제도 outbox 도 남지 않고,
     * 앱은 이 DELETE 실패를 삼키고 로컬 인증을 지우므로 <b>아무도 재시도하지 않고 이전 계정 푸시가
     * 그 기기로 계속 간다</b>.
     *
     * @param deviceToken     대상 FCM 토큰 — {@code X-Device-Token} 으로 받은 값(㊪). 없으면 outbox 를
     *                        계약대로 만들 수 없다
     * @param ownershipToken  {@code X-Device-Ownership} 으로 받은 CAS 값(㊚). 롤아웃 기간엔 null 가능
     * @param authGeneration  AT 의 {@code gen} claim. <b>없으면 null 그대로</b> 보낸다(㊍)
     */
    public DurableCommandAck recordDeviceTokenDeletion(UUID userId, String deviceToken, String ownershipToken,
            Long authGeneration, String idempotencyKey, Deadline deadline) {
        return recordDeviceTokenDeletion(userId, deviceToken, ownershipToken, authGeneration,
                null, idempotencyKey, deadline);
    }

    public DurableCommandAck recordDeviceTokenDeletion(UUID userId, String deviceToken, String ownershipToken,
            Long authGeneration, UUID sessionId, String idempotencyKey, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_DEVICE_TOKEN_DELETIONS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(new DeviceTokenDeletionCommand(deviceToken, ownershipToken, authGeneration, sessionId))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /**
     * 알림 설정 변경을 <b>Data 에 먼저 내구 저장</b>한다 (A22 ㊷ · ㋕ · §3).
     *
     * <p>동기 호출만으로 끝내면 알림 서버 장애가 공통 재시도보다 길 때 변경이 영구 유실되는데,
     * 앱은 {@code NotificationSettingsScreen.tsx:142-148} 에서 <b>화면을 먼저 바꾼 뒤 서버 오류를 삼키고
     * 「다음 변경 때」까지 재시도하지 않는다</b> — 사용자는 껐다고 보는데 정본은 계속 true 라 푸시가
     * 무기한 간다. 그래서 Data outbox(relay 가 재전달)를 먼저 만든다.
     *
     * <p>응답의 {@code version} 이 <b>역순 적용을 막는 유일한 값</b>이다(㋕) — 「끔」이 알림엔 성공했지만
     * 완료 표시만 실패하고 뒤이은 「켬」이 끝까지 성공하면, relay 가 남은 「끔」을 나중에 적용해 사용자가
     * 켠 설정을 도로 끈다.
     */
    public DurableCommandAck recordNotificationSettings(UUID userId, Object settings, String idempotencyKey,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT,
                                PATH_NOTIFICATION_SETTINGS_COMMANDS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(settings)
                        // 전체 교체 PUT 이라 멱등이다(§4 의 재시도 대상).
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /** 신규 설정의 동기 사용자/세션 검사와 초기화용 mirror 스냅샷은 같은 Data TX다. */
    public JsonNode settingsSnapshot(UUID userId, UUID sessionId, long generation, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                "/internal/users/" + userId + "/notification-settings-snapshot")
                        .onBehalfOf(userId)
                        .body(Map.of("sessionId", sessionId, "authGeneration", generation))
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

    /** UUID 앱 키를 그대로 Data의 공개 명령 receipt에 전달한다. */
    public JsonNode patchSettings(UUID userId, UUID sessionId, long generation, boolean notifications,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH,
                                PATH_NOTIFICATION_SETTINGS_COMMANDS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(Map.of("notifications", notifications, "sessionId", sessionId,
                                "authGeneration", generation))
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

    /**
     * 직접 전달이 성공했으니 그 outbox 행을 완료 표시한다 (㊿ 의 「빠른 경로」).
     *
     * <p><b>이 호출이 실패해도 사용자 요청을 실패시키지 않는다</b> — relay 가 한 번 더 보낼 뿐이고,
     * 위성의 멱등·version 규칙이 중복 적용을 흡수한다. 반대로 여기서 실패를 올리면 이미 반영된 변경이
     * 사용자에게 오류로 보인다.
     */
    public void markCommandDelivered(UUID userId, UUID commandId, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, PATH_COMMAND_DELIVERED.replace("{commandId}", commandId.toString()))
                        .onBehalfOf(userId)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /** 링크 발급에 실을 코어 사실을 받는다 — 그룹 활성·멤버십·스냅샷·epoch·linkVersion. */
    public InviteIssueContext fetchInviteIssueContext(UUID groupId, UUID inviterId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET,
                                PATH_INVITE_ISSUE_CONTEXT.replace("{groupId}", groupId.toString()))
                        .onBehalfOf(inviterId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<InviteIssueContext>() { });
    }

    /**
     * claim 의도를 Data 에 <b>내구 적재</b>한다 — {@code 202} 를 줄 수 있는 유일한 근거다.
     *
     * <p>정지 창의 claim 은 거절이 아니라 대기다(A22 ㊄: 앱은 다음 로그인까지 재시도하지 않는다).
     * 전역 15초를 넘길 위험이 있으면 {@code 202} 로 받되, <b>큐 커밋 전에는 202 를 응답하지 않는다</b>.
     */
    public ClaimIntentAck enqueueClaimIntent(UUID userId, String slug, String idempotencyKey,
            Deadline deadline) {
        ClaimIntentAck intent = http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM_INTENTS)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("slug", slug))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentAck>() { });
        if (intent == null || intent.commandId() == null
                || intent.eventId() == null || intent.eventId().isBlank() || intent.version() <= 0) {
            throw new UpstreamContractMismatchException("초대 claim 의도 응답이 완전하지 않습니다");
        }
        return intent;
    }

    /**
     * 링크가 만든 <b>잠정(pending) claim</b> 을 Data 의 멤버십 락 아래에서 확정한다 (A22 ㋟).
     *
     * <p>확정 전달은 <b>Business 가 링크를 직접 호출하지 않는다</b> — Data 가 락 아래
     * {@code link.claimConfirmed} outbox 를 기록하고 relay 가 전달한다. 락을 잡은 채 외부 호출은 §3
     * 위반이고, 락이 풀린 뒤 Business 가 보내면 그 사이 revoke 가 끼어든다.
     *
     * @param capability 링크 서버가 서명한 자격(slug · groupId · inviterId · membershipEpoch · 만료).
     *                   Data 가 <b>커밋 안에서</b> 현재 그룹 상태·멤버십 epoch 와 대조한다(ⓚ)
     */
    public DurableCommandAck confirmClaim(UUID userId, UUID claimId, String slug, String capability,
            String idempotencyKey, Deadline deadline) {
        DurableCommandAck confirmed = http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_CLAIM_CONFIRMATIONS)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(new ClaimConfirmationCommand(claimId, slug, capability))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
        if (confirmed == null || confirmed.commandId() == null
                || confirmed.eventId() == null || confirmed.eventId().isBlank() || confirmed.version() <= 0) {
            throw new UpstreamContractMismatchException("초대 claim 확정 응답이 완전하지 않습니다");
        }
        return confirmed;
    }

    /**
     * 결과 표시 선점 — 알림 서버가 끼지 않는다. 조건부 원자 UPDATE 라 <b>재시도하지 않는다</b>:
     * 최초 획득은 멱등이 아니고(두 번째 시도가 남의 리스를 가져올 수 있다) 실패 응답이 계약이다
     * ({@code RESULT_CLAIM_HELD} + {@code retryAfterMs}).
     */
    public Object claimResultDisplay(UUID userId, UUID sessionId, UUID currentToken, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, resultPath(PATH_RESULT_CLAIM, userId, sessionId))
                        .onBehalfOf(userId)
                        .body(Map.of("claimToken", currentToken == null ? "" : currentToken.toString()))
                        .build(),
                deadline,
                new ParameterizedTypeReference<Object>() { });
    }

    /**
     * 결과 확인(ack) 커밋 — 2단계의 <b>가운데</b>다 (A22 ⓓ). 앞에 알림 prepare, 뒤에 알림 commit 이 온다.
     *
     * <p>재시도하지 않는다: {@code acknowledged_at IS NULL} 조건부 UPDATE 라 두 번째 시도는 0행이 되고,
     * 그 0행을 실패로 읽으면 이미 성공한 ack 가 실패로 보고된다.
     */
    public void acknowledgeResult(UUID userId, UUID sessionId, UUID claimToken, Instant ackDeadlineAt,
            Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, resultPath(PATH_RESULT_ACK, userId, sessionId))
                        .onBehalfOf(userId)
                        .body(Map.of("claimToken", claimToken == null ? "" : claimToken.toString(),
                                "ackDeadlineAt", ackDeadlineAt.toString()))
                        .build(),
                deadline);
    }

    /**
     * 구 {@code invite_link_clicks} 정지 스냅샷의 <b>read-only export</b> (§7.2 5단계).
     *
     * <p>Business 는 이 후보를 <b>소진하지 않는다</b> — 쓰기 원장은 Neon 하나다(A22 ㊥).
     * {@code migrationId} 로 제한된 이관 경로이고 일반 방문자 입력으로 받지 않는다.
     */
    public List<FrozenClickCandidate> exportFrozenCandidates(String migrationId, String ipHash, String os,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_FROZEN_CANDIDATES.replace("{migrationId}", migrationId))
                        .query("ipHash", ipHash)
                        .query("os", os)
                        .build(),
                deadline,
                new ParameterizedTypeReference<List<FrozenClickCandidate>>() { });
    }

    /**
     * 미완료 claim 의도 조회 — <b>서비스 전용</b>이라 {@code X-User-Id} 가 없다. 재개 CLI 만 쓴다.
     *
     * <p>이 경로가 없으면 큐에 적재된 의도를 비울 주체가 존재하지 않는다 — Business 에는 크론이 없고
     * (§6) Data 는 링크를 relay 허용목록 밖으로 부를 수 없다(§3).
     */
    public ClaimIntentPage fetchPendingClaimIntents(String cursor, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_CLAIM_INTENTS_PENDING)
                        .query("cursor", cursor)
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentPage>() { });
    }

    /**
     * lease 획득. CLI 중복 실행·이전 실행의 잔여가 같은 의도를 동시에 재생하는 것을 막는다.
     *
     * <p>재시도한다: 같은 소유자가 같은 의도에 다시 요청하면 같은 답이 나와야 하고(멱등), 여기서
     * 실패를 올리면 그 의도만 영구히 건너뛴다.
     */
    public ClaimIntentLease leaseClaimIntent(UUID commandId, long leaseSeconds, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                PATH_CLAIM_INTENT_LEASE.replace("{commandId}", commandId.toString()))
                        .body(Map.of("leaseSeconds", leaseSeconds))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ClaimIntentLease>() { });
    }

    /**
     * 재개 완료 표시 — <b>{@code leaseToken} 으로 CAS</b> 한다.
     *
     * <p>토큰 없이 완료 표시하면 <b>임대가 만료된 뒤 깨어난 옛 작업자가 「새 임대 소유자의 작업」을
     * 완료로 빼 버린다</b>: A 의 lease 가 만료되고 B 가 새로 잡아 재생 중인데 느려진 A 가 완료를
     * 부르면, B 의 진행과 무관하게 큐에서 사라져 <b>확정되지 않은 claim 이 「완료」로 기록</b>된다.
     * 현재 임대의 토큰과 다르면 Data 가 거부해야 한다.
     *
     * <p>같은 토큰으로 다시 와도 200 이어야 한다(멱등) — 409 면 CLI 가 정상 중복을 오류로 센다.
     */
    public void completeClaimIntent(UUID commandId, UUID leaseToken, Deadline deadline) {
        completeClaimIntent(commandId, leaseToken, null, deadline);
    }

    /** 재개 중 확정된 거절 코드도 원래 요청의 재생을 위해 전달한다. */
    public void completeClaimIntent(UUID commandId, UUID leaseToken, String terminalCode, Deadline deadline) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("leaseToken", leaseToken.toString());
        if (terminalCode != null) {
            body.put("terminalCode", terminalCode);
        }
        http.execute(
                InternalCall.to(HttpMethod.POST,
                                PATH_CLAIM_INTENT_COMPLETED.replace("{commandId}", commandId.toString()))
                        .body(body)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /**
     * 확정할 것이 없던 claim 의도를 <b>요청자 자신이</b> 종결한다 — 사용자 위임 경로다.
     *
     * <p>링크가 {@code claimId=null} 을 주면(셀프 초대 · 붙일 클릭 없음) 확정 호출이 없고, 확정이
     * 없으면 Data 의 확정 경로가 의도를 닫아 주지도 못한다 — 그 한 건이 {@code PENDING} 으로 남아
     * <b>정상 처리된 claim 이 「미완료 0」 gate 를 영구히 막는다</b>.
     *
     * <p><b>{@link #markCommandDelivered} 로 닫을 수 없다.</b> 그쪽은 봉투의 {@code eventId} 로
     * 「알림 대상 전달」을 닫는 경로이고 claim 의도는 outbox 행이 아니다 — 의도 id 를 그 경로에 보내면
     * <b>항상 404</b> 다. 반대로 {@code …/completed} 는 lease 를 쥔 <b>서비스 전용</b> 재개 표면이라
     * 요청 경로가 빌려 쓰면 임의 의도를 선점·완료할 권한이 생긴다.
     *
     * <p>이미 종결된 의도에 다시 와도 200 이다(멱등). 이 호출의 실패는 사용자 요청을 실패시키지
     * 않는다 — 남은 의도는 재개 CLI 가 한 번 더 밟고, 그쪽도 같은 「붙일 대상 없음」으로 종결한다.
     */
    public void abandonClaimIntent(UUID userId, UUID commandId, String terminalCode, Deadline deadline) {
        // 종결 코드를 함께 남긴다. 원장이 그 코드를 갖고 있어야 같은 요청 키의 재시도가 「첫 요청이
        // 받은 그 판정」을 그대로 재생할 수 있다 — 없으면 첫 요청은 4xx, 재시도는 200 이 된다.
        //
        // 코드는 «본문»으로 보낸다. 경로에 실으면 같은 종결이 코드마다 다른 URL 이 되어, 경로로
        // 계약을 고정한 검사들이 값에 따라 갈린다 — 경로는 「무엇을 하는가」지 「왜 하는가」가 아니다.
        InternalCall.Builder call = InternalCall.to(HttpMethod.POST,
                        PATH_CLAIM_INTENT_ABANDONED.replace("{commandId}", commandId.toString()))
                .onBehalfOf(userId)
                .idempotentCommand();
        if (terminalCode != null) {
            call.body(Map.of("terminalCode", terminalCode));
        }
        http.execute(call.build(), deadline);
    }

    /**
     * 집중 세션 시작 (GROMO-1764). 앱이 준 UUID 키를 그대로 실어 Data 의 공개 명령 receipt 를 재생한다 —
     * 응답 유실 뒤 재시도가 <b>두 번째 세션</b>이 되지 않게 하는 유일한 장치다.
     */
    public FocusSessionState startFocusSession(UUID userId, UUID islandId, String subject, Integer targetMinutes,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_FOCUS_SESSIONS, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new FocusSessionStartCommand(islandId, subject, targetMinutes))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<FocusSessionState>() { });
    }

    /**
     * 본인의 진행 세션 조회. 세션이 없어도 {@code {"session": null}} 이 오고, <b>빈 본문은 계약 위반</b>이다
     * — 롤링 배포·프록시가 돌려준 빈 200 을 「세션 없음」으로 읽으면 진행 중인 집중이 사라진 것처럼 보인다.
     */
    public CurrentFocusSession fetchCurrentFocusSession(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FOCUS_SESSION_CURRENT, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<CurrentFocusSession>() { });
    }

    /** 집중 → 휴식 전이. expectedVersion 비교와 자리 배정은 Data 의 세션 행 잠금 안에서만 일어난다. */
    public FocusSessionState pauseFocusSession(UUID userId, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return transitionFocusSession(PATH_FOCUS_SESSION_PAUSE, userId, sessionId, expectedVersion, key, deadline,
                new ParameterizedTypeReference<FocusSessionState>() { });
    }

    /** 휴식 → 집중 전이. */
    public FocusSessionState resumeFocusSession(UUID userId, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return transitionFocusSession(PATH_FOCUS_SESSION_RESUME, userId, sessionId, expectedVersion, key, deadline,
                new ParameterizedTypeReference<FocusSessionState>() { });
    }

    /**
     * 세션 종료·정산. 보상 정책이 확정되기 전에는 Data 가 {@code REWARD_POLICY_UNAVAILABLE}(503) 로
     * 막는 것이 정상 동작이다 — 「0원 지급 성공」으로 위장하지 않는다.
     */
    public FocusFinish finishFocusSession(UUID userId, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return transitionFocusSession(PATH_FOCUS_SESSION_FINISH, userId, sessionId, expectedVersion, key, deadline,
                new ParameterizedTypeReference<FocusFinish>() { });
    }

    /** 홈 요약. 날짜·timezone 판정은 Data 가 한다 — 여기서 KST 규약을 두 번 해석하지 않는다. */
    public FocusSummary fetchFocusSummary(UUID userId, String date, String timezone, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FOCUS_SUMMARY, userId))
                        .onBehalfOf(userId)
                        .query("date", date)
                        .query("timezone", timezone)
                        .build(),
                deadline,
                new ParameterizedTypeReference<FocusSummary>() { });
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
     * 400)은 Data 가 한다 — 여기서 두 번 해석하지 않는다. 생략된 파라미터는 아예 실지 않는다.
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

    private <T> T transitionFocusSession(String template, UUID userId, UUID sessionId, long expectedVersion,
            UUID key, Deadline deadline, ParameterizedTypeReference<T> responseType) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(template, userId).replace("{sessionId}",
                                sessionId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new FocusVersionedCommand(expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                responseType);
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
                InternalCall.to(HttpMethod.GET, PATH_ISLAND.replace("{islandId}", islandId.toString()))
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
     * 건설 옵션 스냅샷 (GROMO-1767). 멱등 GET 이라 재시도한다. selectable/buildable 판정과
     * 권한 거절은 전부 상류 몫이다 — 주체는 {@code onBehalfOf} 로만 전달한다.
     */
    public ConstructionOptions fetchConstructionOptions(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_CONSTRUCTION_OPTIONS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<ConstructionOptions>() { });
    }

    /**
     * 건설 목표 선택 (GROMO-1767). 차감이 없는 선택 명령이라 costPolicyVersion·잔액을 요구하지
     * 않는다(C03). 전체 교체 PUT 이라 멱등이고 앱 키를 그대로 전달한다.
     */
    public ConstructionTarget selectConstructionTarget(UUID userId, UUID islandId, String buildingId,
            long expectedVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT, islandPath(PATH_CONSTRUCTION_TARGET, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new ConstructionTargetCommand(buildingId, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ConstructionTarget>() { });
    }

    /**
     * 건설 시작 (GROMO-1767). {@code expectedCostPolicyVersion} 은 «사용자가 본 가격»의 동의
     * 증거다 — 가격만 바뀌어도 상류가 409 로 거절한다(C10). 응답 유실 복구는 같은 키 재생이다.
     */
    public ConstructionResult startConstruction(UUID userId, UUID islandId, String buildingId,
            long expectedVersion, long expectedCostPolicyVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_CONSTRUCTIONS, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new ConstructionStartCommand(buildingId, expectedVersion,
                                expectedCostPolicyVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ConstructionResult>() { });
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

    private static String noticePath(String template, UUID islandId, UUID noticeId) {
        return islandPath(template, islandId).replace("{noticeId}", noticeId.toString());
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
     * null 로 채워 보내면 상류가 명시 null 로 읽고 거절한다.
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
     * 개인 인벤토리 (GROMO-1783). 멱등 GET 이라 재시도한다 — 목록과 equipped 는 Data 가 한
     * 스냅샷으로 돌려준다.
     */
    public PersonalInventory fetchMyInventory(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_MY_INVENTORY, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<PersonalInventory>() { });
    }

    /**
     * 개인 외양 적용 (GROMO-1783). {@code fields}·{@code values} 는 공개 본문의 tri-state 를
     * 그대로 옮긴 캐리어다 — 명시 null 이 해제 의미라 필드 제거로 바꾸면 다른 명령이 된다.
     * 앱 키를 그대로 전달해 같은 키의 재시도는 Data 의 receipt 재생이다.
     */
    public PersonalAppearancePatchResult patchMyAppearance(UUID userId, List<String> fields,
            Map<String, Object> values, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, userPath(PATH_MY_APPEARANCE, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new AppearancePatchCommand(fields, values, null))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<PersonalAppearancePatchResult>() { });
    }

    /** 공동 인벤토리 (GROMO-1783). 활성 주민만 — 비주민 거절은 Data 의 MEMBER_ONLY 다. */
    public SharedInventory fetchIslandInventory(UUID islandId, UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_INVENTORY, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<SharedInventory>() { });
    }

    /**
     * 공동 외양 적용 (GROMO-1783). SHARED_APPEARANCE(방장) 전용이고 {@code expectedVersion} 은
     * 「사용자가 본 외양」의 동의 증거다 — 지문에 들어가 같은 키의 다른 본문은 재사용 거절이 된다.
     */
    public IslandAppearancePatchResult patchIslandAppearance(UUID islandId, UUID userId,
            List<String> fields, Map<String, Object> values, long expectedVersion, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, islandPath(PATH_ISLAND_APPEARANCE, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new AppearancePatchCommand(fields, values, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandAppearancePatchResult>() { });
    }

    /** 공용 음악 재생 상태 (GROMO-1779). 활성 주민 + 방송기 완공 — 멱등 GET 이라 재시도한다. */
    public PlaybackState fetchIslandPlayback(UUID islandId, UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_PLAYBACK, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<PlaybackState>() { });
    }

    /**
     * 공용 음악 재생 변경 (GROMO-1779). 외양과 같은 tri-state 캐리어 — 제출된 필드만 싣는다. 앱 키를
     * 그대로 전달해 같은 키의 재시도는 Data 의 receipt 재생이다.
     */
    public PlaybackPatchResult patchIslandPlayback(UUID islandId, UUID userId, List<String> fields,
            Map<String, Object> values, long expectedVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, islandPath(PATH_ISLAND_PLAYBACK, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new AppearancePatchCommand(fields, values, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<PlaybackPatchResult>() { });
    }

    /** 상점 지갑 두 개 (GROMO-1781) — 활성 주민 전용. 멱등 GET 이라 재시도한다. */
    public ShopViews.Wallets fetchShopWallets(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_WALLETS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.Wallets>() { });
    }

    /**
     * 상점 카탈로그 한 쪽 (GROMO-1781). 경계 세 값은 서명 커서를 푼 이전 쪽의 발행본·마지막 정렬키다 — 첫 쪽은
     * 싣지 않는다. owned/available 판정은 전부 상류 몫이다.
     */
    public ShopViews.ProductPage fetchShopProducts(UUID userId, UUID islandId, String category,
            Long publicationVersion, Integer afterDisplayOrder, String afterProductId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_PRODUCTS, islandId))
                        .onBehalfOf(userId)
                        .query("category", category)
                        .query("publicationVersion", publicationVersion == null ? null : publicationVersion.toString())
                        .query("afterDisplayOrder", afterDisplayOrder == null ? null : afterDisplayOrder.toString())
                        .query("afterProductId", afterProductId)
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.ProductPage>() { });
    }

    /** 상품 상세 (GROMO-1781). productId 는 공개 경계가 안전 문자로 거른 카탈로그 문자열이다. */
    public ShopViews.Product fetchShopProduct(UUID userId, UUID islandId, String productId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_PRODUCTS, islandId) + "/" + productId)
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.Product>() { });
    }

    /**
     * 구매 (GROMO-1781). 두 version 은 «사용자가 본 가격·잔액»의 동의 증거다. 앱 키를 그대로 전달해 응답 유실
     * 복구는 Data 의 receipt 재생이다 — 가격·통화·주인은 보내지 않는다(서버가 판매 revision 에서 정한다).
     */
    public ShopViews.Order purchaseShopProduct(UUID userId, UUID islandId, String productId,
            long expectedWalletVersion, long expectedProductVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_SHOP_ORDERS, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new ShopOrderCommand(productId, expectedWalletVersion, expectedProductVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.Order>() { });
    }

    /** 섬 귀속 구매 내역 (GROMO-1781, BG18). anchor 두 값은 서명 커서를 푼 이전 쪽의 마지막 행이다. */
    public ShopViews.OrderPage fetchShopOrders(UUID userId, UUID islandId, String scope, Instant afterCreatedAt,
            UUID afterId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_ORDERS, islandId))
                        .onBehalfOf(userId)
                        .query("scope", scope)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterId", afterId == null ? null : afterId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.OrderPage>() { });
    }

    /** 현재 퀘스트 회차 (GROMO-1773). 멱등 GET 이라 재시도한다 — 판정은 전부 상류 몫이다. */
    public IslandQuestViews.Current fetchCurrentQuests(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_QUESTS_CURRENT, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Current>() { });
    }

    /** 회차 진행 (GROMO-1773). 회차 id 만 질의로 싣는다 — 커서는 Business 가 판정한다. */
    public IslandQuestViews.Progress fetchQuestProgress(UUID userId, UUID islandId, UUID questId,
            UUID occurrenceId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, questPath(islandId, questId) + "/progress")
                        .onBehalfOf(userId)
                        .query("occurrenceId", occurrenceId.toString())
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Progress>() { });
    }

    /** 퀘스트 생성 (GROMO-1773). 앱 키를 그대로 전달해 같은 키의 재시도는 Data 의 receipt 재생이다. */
    public IslandQuestViews.Created createQuest(UUID userId, UUID islandId, QuestCreateCommand command, UUID key,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_QUESTS, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(command)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Created>() { });
    }

    /** 퀘스트 정의 수정 (GROMO-1773). 생략 필드는 유지 — null 로 실리면 상류도 «유지»로 읽는다. */
    public IslandQuestViews.Updated updateQuest(UUID userId, UUID islandId, UUID questId, String title,
            Integer targetMinutes, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, questPath(islandId, questId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new QuestUpdateCommand(title, targetMinutes))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Updated>() { });
    }

    /** 회차 정산 (GROMO-1773). expectedVersion 은 지문에 들어가 같은 키의 다른 본문은 재사용 거절이 된다. */
    public IslandQuestViews.Claimed claimQuest(UUID userId, UUID islandId, UUID questId, UUID occurrenceId,
            long expectedVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, questPath(islandId, questId) + "/claims")
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new QuestClaimCommand(occurrenceId, expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandQuestViews.Claimed>() { });
    }

    private static String questPath(UUID islandId, UUID questId) {
        return islandPath(PATH_QUESTS, islandId) + "/" + questId;
    }

    private static String userPath(String template, UUID userId) {
        return template.replace("{userId}", userId.toString());
    }

    private String resultPath(String template, UUID userId, UUID sessionId) {
        return template.replace("{userId}", userId.toString()).replace("{sessionId}", sessionId.toString());
    }

    /** 삭제 outbox 요청 본문. {@code authGeneration} 은 <b>없으면 null</b> 이고 채우지 않는다(㊍). */
    record DeviceTokenDeletionCommand(String deviceToken, String ownershipToken, Long authGeneration, UUID sessionId) {
    }

    /** claim 확정 요청 본문. */
    record ClaimConfirmationCommand(UUID claimId, String slug, String capability) {
    }

    /** 집중 세션 시작 요청 본문 (GROMO-1764). */
    record FocusSessionStartCommand(UUID islandId, String subject, Integer targetMinutes) {
    }

    /** pause/resume/finish 공용 요청 본문 — expectedVersion 필수(FR-P07). */
    record FocusVersionedCommand(long expectedVersion) {
    }

    /** 친구 요청 생성 본문 (GROMO-1894). 보내는 쪽은 X-User-Id 로 가므로 받는 쪽만 담는다. */
    record FriendRequestCommand(UUID targetUserId) {
    }

    /** 편지 발송 본문 (GROMO-1933). 보내는 쪽은 X-User-Id 로 가므로 받는 쪽과 본문만 담는다. */
    record LetterSendCommand(UUID receiverId, String content) {
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

    /** 건설 목표 선택 요청 본문 (GROMO-1767). 잔액·가격 동의를 요구하지 않는다(C03). */
    record ConstructionTargetCommand(String buildingId, long expectedVersion) {
    }

    /** 건설 시작 요청 본문 (GROMO-1767). 두 버전 필드가 모두 필수다(LLD §2). */
    record ShopOrderCommand(String productId, long expectedWalletVersion, long expectedProductVersion) {
    }

    record ConstructionStartCommand(String buildingId, long expectedVersion, long expectedCostPolicyVersion) {
    }

    /** 공지 작성 본문 (GROMO-1771). 작성자는 X-User-Id 로 간다. */
    record NoticeCreateCommand(String title, String body) {
    }

    /** 댓글 작성 본문 (GROMO-1771). */
    record NoticeCommentCommand(String text) {
    }

    /**
     * 퀘스트 생성 요청 본문 (GROMO-1773). 창 필드는 focus 만 — screen 이면 null 이고, Data 는 null 을 «없음»으로
     * 읽는다. {@code timezone} 은 앱이 보낸 값 그대로(생략이면 null)다.
     */
    public record QuestCreateCommand(String title, String type, int targetMinutes, String windowStart,
                                     String windowEnd, String timezone) {
    }

    /** 퀘스트 수정 요청 본문 (GROMO-1773). */
    record QuestUpdateCommand(String title, Integer targetMinutes) {
    }

    /** 회차 정산 요청 본문 (GROMO-1773). */
    record QuestClaimCommand(UUID occurrenceId, long expectedVersion) {
    }

    /** 계정 projection (GROMO-1801 · 계정 LLD §2.2). 멱등 GET 이라 재시도한다. */
    public AccountMe fetchAccount(UUID userId, UUID sessionId, long generation, Deadline deadline) {
        return http.exchange(account(HttpMethod.GET, userId, sessionId, generation).build(), deadline,
                new ParameterizedTypeReference<AccountMe>() { });
    }

    /**
     * 이름·고양이 색·메인 섬 변경 (GROMO-1801·1945·1971 · 계정 LLD §2.3). 앱 키를 그대로 Data 의 공개 명령 receipt 에 전달한다.
     * 온 필드만 싣는다 — {@code null} 은 「미변경」이라 본문에서 뺀다.
     */
    public AccountProfile patchAccount(UUID userId, UUID sessionId, long generation, String name, String catColor,
            UUID mainIslandId, UUID key, Deadline deadline) {
        Map<String, String> body = new LinkedHashMap<>();
        if (name != null) {
            body.put("name", name);
        }
        if (catColor != null) {
            body.put("catColor", catColor);
        }
        if (mainIslandId != null) {
            body.put("mainIslandId", mainIslandId.toString());
        }
        return http.exchange(account(HttpMethod.PATCH, userId, sessionId, generation)
                        .idempotencyKey(key.toString())
                        .body(body)
                        .idempotentCommand()
                        .build(), deadline,
                new ParameterizedTypeReference<AccountProfile>() { });
    }

    /**
     * 탈퇴 (GROMO-1801 · 계정 LLD §2.5). 응답 유실 뒤 재시도는 이미 비활성이라 404 {@code USER_NOT_FOUND} 이고,
     * 앱은 그것을 탈퇴 확정으로 읽는다 — 그래서 재시도해도 안전하다.
     */
    public JsonNode deleteAccount(UUID userId, UUID sessionId, long generation, Deadline deadline) {
        return http.exchange(account(HttpMethod.DELETE, userId, sessionId, generation)
                        .idempotentCommand()
                        .build(), deadline,
                new ParameterizedTypeReference<JsonNode>() { });
    }

    private static InternalCall.Builder account(HttpMethod method, UUID userId, UUID sessionId, long generation) {
        return InternalCall.to(method, PATH_ACCOUNT.replace("{userId}", userId.toString()))
                .onBehalfOf(userId)
                .header(HEADER_SESSION, sessionId.toString())
                .header(HEADER_GENERATION, Long.toString(generation));
    }

    /**
     * 외양 PATCH 요청 본문 (GROMO-1783). tri-state 캐리어 — {@code fields} 는 제출된 필드명,
     * {@code values} 는 그 원시 값(명시 null 보존)이다. {@code expectedVersion} 은 공동
     * PATCH 에만 채운다.
     */
    record AppearancePatchCommand(List<String> fields, Map<String, Object> values,
                                  Long expectedVersion) {
    }

    /**
     * 집중 통계 (GROMO-1769). 멱등 GET 이라 재시도한다. 다음 페이지 경계(스냅샷 id·offset)는 Business 가 서명 커서에서
     * 꺼낸 평문이다.
     */
    public IslandRecordViews.FocusStatistics fetchFocusStatistics(UUID userId, UUID islandId, LocalDate from,
            LocalDate to, String scope, UUID snapshotId, Integer offset, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_FOCUS_STATISTICS, islandId))
                        .onBehalfOf(userId)
                        .query("from", from.toString())
                        .query("to", to.toString())
                        .query("scope", scope)
                        .query("snapshotId", snapshotId == null ? null : snapshotId.toString())
                        .query("offset", offset == null ? null : offset.toString())
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRecordViews.FocusStatistics>() { });
    }

    /**
     * 섬 공동 가계부 한 쪽 (GROMO-1895). 멱등 GET 이라 재시도한다. {@code month} 는 KST 달력 월
     * ({@code YYYY-MM}), 경계는 평문 keyset({@code afterCreatedAt}+{@code afterEntryId} 둘 다 또는 둘 다 없음)이다.
     */
    public IslandLedger fetchIslandLedger(UUID userId, UUID islandId, String month, String direction,
            Instant afterCreatedAt, UUID afterEntryId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_ISLAND_LEDGER, islandId))
                        .onBehalfOf(userId)
                        .query("month", month)
                        .query("direction", direction)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterEntryId", afterEntryId == null ? null : afterEntryId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandLedger>() { });
    }

    /** 스크린타임 통계 (GROMO-1769). 멱등 GET 이라 재시도한다. */
    public IslandRecordViews.ScreenTimeStatistics fetchScreenTimeStatistics(UUID userId, UUID islandId,
            LocalDate from, LocalDate to, String scope, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SCREEN_TIME_STATISTICS, islandId))
                        .onBehalfOf(userId)
                        .query("from", from.toString())
                        .query("to", to.toString())
                        .query("scope", scope)
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRecordViews.ScreenTimeStatistics>() { });
    }

    /**
     * 주간 섬 랭킹 (GROMO-1997). 멱등 GET 이라 재시도한다. {@code week} 는 주 시작일(UTC 일요일)이고, 전망대·주민
     * 판정과 달력 의미(일요일인가·아직 오지 않은 주인가)는 Data 가 한다.
     */
    public IslandRankingViews.IslandRankingPage fetchIslandRankings(UUID userId, LocalDate week, Integer limit,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_ISLAND_RANKINGS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .query("week", week.toString())
                        .query("limit", limit == null ? null : limit.toString())
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRankingViews.IslandRankingPage>() { });
    }

    /**
     * 기기 측정 PUT (GROMO-1769). 앱 키를 그대로 Data 의 공개 명령 receipt 에 전달하고, 세션·세대는 서명된 AT 에서만
     * 가져온다 — 측정 기기 = 이 세션인지는 Data 가 판정한다.
     */
    public IslandRecordViews.ScreenTimeDay putScreenTime(UUID userId, UUID sessionId, long generation,
            LocalDate date, Map<String, Object> body, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT, "/internal/users/" + userId + "/screen-time/" + date)
                        .onBehalfOf(userId)
                        .header(HEADER_SESSION, sessionId.toString())
                        .header(HEADER_GENERATION, Long.toString(generation))
                        .idempotencyKey(key.toString())
                        .body(body)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<IslandRecordViews.ScreenTimeDay>() { });
    }
}

package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.MyIslandsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.ReadFragment;
import com.oneorthree.business.common.http.ScreenComposer;
import com.oneorthree.business.common.http.UpstreamRequestContext;
import com.oneorthree.business.upstream.data.dto.ConstructionOptions;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.IslandDetail;
import com.oneorthree.business.upstream.data.dto.IslandSummary;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import com.oneorthree.business.upstream.realtime.dto.RealtimeHistory;
import lombok.RequiredArgsConstructor;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * 화면 조회 — 도메인 GET 을 {@link ScreenComposer} 로 병렬 조합한다 (GROMO-1896, bff-screens 정책 B24).
 *
 * <p>조각은 전부 필수다(B04) — 하나라도 실패하면 화면 전체가 그 조각의 공개 오류로 실패한다. N 상태는
 * 앞 단계 응답으로 판단해 <b>호출 자체를 생략</b>한다(B03). 한 화면의 모든 단계는 {@code start} 가 만든
 * 같은 context·deadline 을 쓴다(B24 ②).
 *
 * <p>조각 값은 도메인 유스케이스를 그대로 불러 얻는다 — 공개 오류 변환·응답 검증이 도메인 GET 과 같아야
 * 화면과 도메인 경로가 같은 실패를 같은 코드로 낸다.
 *
 * <p>ponytail: 화면 DTO 클래스 없음 — 조각 이름이 계약이다(implementation-business-api §3). OpenAPI 문서가
 * 필요해지면 화면별 record 로 올린다. 유스케이스가 500줄을 넘으면 장소별로 나눈다.
 */
@Service
@RequiredArgsConstructor
public class ScreenReadUseCase {

    /** 도메인 GET 기본 limit 과 같아야 한다 — 화면이 발행한 nextCursor 를 도메인 GET 이 그대로 이어받는다(B10). */
    private static final int SEARCH_LIMIT = 20;
    private static final int DISCOVER_LIMIT = 1;
    private static final String FRIEND_REQUESTS_RECEIVED = "received";
    private static final String FRIEND_REQUESTS_SENT = "sent";
    private static final String LETTERS_RECEIVED = "received";
    private static final String AVAILABLE = "available";
    private static final String NONE = "none";
    private static final String HOST_ONLY = "host_only";
    private static final String ROLE_HOST = "host";
    private static final String ROLE_MEMBER = "member";
    private static final String MISSING_FRAGMENTS = "missingFragments";
    private static final String FACILITY_LOCKED = "facility_locked";
    /** 시설 id — 건설 도메인 {@code ConstructionBuilding} 의 계약 문자열(정책 C14). */
    private static final String GRAM = "gram";
    private static final String LIBRARY = "library";
    private static final String SHOP = "shop";
    /** 시설 완공 판정 재료(건설 옵션) — 화면 응답에는 싣지 않는 내부 조각이다. */
    private static final String FACILITIES = "facilities";

    private final ScreenComposer composer;
    private final AccountUseCase account;
    private final IslandMembershipUseCase islands;
    private final FocusSessionUseCase focus;
    private final AppearanceUseCase appearance;
    private final FriendUseCase friends;
    private final NotificationApiClient notification;
    private final IslandFocusMembersUseCase focusMembers;
    private final IslandManagementUseCase management;
    private final IslandConstructionUseCase construction;
    private final IslandQuestUseCase quests;
    private final IslandNoticeUseCase notices;
    private final PlaybackUseCase playback;
    private final IslandMailboxUseCase mailbox;
    private final LetterUseCase letters;
    private final IslandRecordsUseCase records;

    /** {@code launch} — 계정·소속·진행 세션. 세션 없음은 {@code session:null} 정상값이다. */
    public Map<String, Object> launch(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        return composer.compose(context, List.of(
                me(claims),
                memberships(claims),
                fragment("session", deadline -> focus.current(claims, deadline))));
    }

    /** {@code raft} — 계정·개인 보유품·받은 친구 요청(앱이 배열 길이로 센다, friend-letter HLD §3). */
    public Map<String, Object> raft(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        return composer.compose(context, List.of(
                me(claims),
                fragment("inventory", deadline -> appearance.myInventory(claims, deadline)),
                fragment("friendRequests",
                        deadline -> friends.friendRequests(claims, FRIEND_REQUESTS_RECEIVED, deadline))));
    }

    /**
     * {@code account} — 계정·알림 설정. 설정은 순수 GET 으로 정본(Notification)을 읽는다.
     * {@code AccountSettingsUseCase.read()} 는 초기화 POST 를 보내 조합기의 GET 전용 제약에 걸린다(§4 각주).
     * 응답은 공개 {@code GET /me/settings} 모양({@code notifications}) 하나로 투영한다.
     */
    public Map<String, Object> account(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        return composer.compose(context, List.of(
                me(claims),
                fragment("settings", deadline -> {
                    NotificationSettingsView view = notification.getSettings(claims.userId(), deadline);
                    if (view == null) {
                        throw new UpstreamContractMismatchException("알림 설정 조회 응답에 본문이 없습니다");
                    }
                    return new AccountSettingsUseCase.Result(view.notificationEnabled());
                })));
    }

    /**
     * {@code explore} — 소속을 먼저 읽고, 0개면 첫 소속 탐색, 있으면 검색 첫 페이지(B19). 둘을 합치지 않는다.
     * 소속 조회 실패를 미소속으로 바꾸지 않는다 — 필수 조각이라 화면 전체가 실패한다.
     */
    public Map<String, Object> explore(AccessTokenClaims claims, String q, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        Map<String, Object> first = composer.compose(context, List.of(memberships(claims)));
        MyIslandsResponse memberships = (MyIslandsResponse) first.get("memberships");
        ReadFragment<?> list = memberships.items().isEmpty()
                ? fragment("islands", deadline -> islands.discover(claims, null, DISCOVER_LIMIT, deadline))
                : fragment("islands", deadline -> islands.search(claims, q, null, SEARCH_LIMIT, deadline));
        Map<String, Object> screen = new LinkedHashMap<>(composer.compose(context, List.of(list)));
        screen.putAll(first);
        return screen;
    }

    /**
     * {@code visit/{islandId}} — 공개 요약 뒤 주민 목록 첫 페이지와 본인 최신 가입 요청을 병렬로 읽는다. 요청이 없으면
     * 조회하지 않고 {@code joinRequestAvailability:none} 이다. 호출자가 주민이어도 공개 요약 projection 만 싣는다
     * (LLD §1 조각 타입). 주민 목록은 2026-09-19 결정 V-읽기(GROMO-1904·1937)로 방문자에게 열렸다 — 닉네임·
     * 고양이 외형·방장 여부뿐이고, 커서는 도메인 {@code GET /islands/{islandId}/members} 가 이어받는다(B10).
     * 게시판 공지·퀘스트는 싣지 않는다 — 방문자도 게시판 건물을 눌러 도메인 GET 으로 읽는다.
     */
    public Map<String, Object> visit(AccessTokenClaims claims, UUID islandId, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        Map<String, Object> first = composer.compose(context, List.of(
                fragment("island", deadline -> publicSummary(islands.island(claims, islandId, deadline)))));
        IslandSummary island = (IslandSummary) first.get("island");
        List<ReadFragment<?>> fragments = new ArrayList<>(List.of(fragment("members",
                deadline -> management.members(claims, islandId, null, IslandManagementUseCase.DEFAULT_LIMIT,
                        deadline))));
        if (island.joinRequestId() != null) {
            fragments.add(fragment("joinRequest",
                    deadline -> islands.joinRequest(claims, island.joinRequestId(), deadline)));
        }
        Map<String, Object> second = composer.compose(context, fragments);
        Map<String, Object> screen = new LinkedHashMap<>(first);
        screen.put("members", second.get("members"));
        if (island.joinRequestId() == null) {
            screen.put("joinRequestAvailability", NONE);
            screen.put("joinRequest", null);
            return screen;
        }
        JoinRequestStatus joinRequest = (JoinRequestStatus) second.get("joinRequest");
        if (!islandId.equals(joinRequest.islandId())) {
            throw new UpstreamContractMismatchException("가입 요청의 섬이 방문 섬과 다릅니다");
        }
        screen.put("joinRequestAvailability", AVAILABLE);
        screen.put("joinRequest", joinRequest);
        return screen;
    }

    // ------------------------------------------------ 섬 장소 화면 (GROMO-1897)
    //
    // 아직 도메인 GET 이 없는 조각은 호출하지 않고 명시 null 로 두며 missingFragments 에 이름을 싣는다.
    // 검증된 비적용(N)이 아니므로 …Availability 로 위장하지 않는다 — 그 값도 null 이다. 제공자가
    // 머지되면 해당 조각을 병렬 목록으로 옮기고 이름을 뺀다.

    /**
     * {@code home} — 섬 문맥 뒤 오늘 집중 요약·현재 세션·휴식 주민·방송기 완공 판정을 병렬로 읽고, 방송기가
     * 완공이면 {@code playback} 을 읽는다. 휴식 주민은 BG11 결정(2026-09-19)으로 싣는다 — 도메인 403 이면
     * 다른 조각처럼 화면 전체가 실패한다. 빠진 조각: {@code wallets}(섬 상점 지갑 GET 없음).
     */
    public Map<String, Object> home(AccessTokenClaims claims, String date, String timezone, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        Map<String, Object> parallel = composer.compose(context, List.of(
                fragment("focusSummary", deadline -> focus.summary(claims, date, timezone, deadline)),
                fragment("session", deadline -> focus.current(claims, deadline)),
                fragment("restMembers", deadline -> focusMembers.restMembers(claims, island.id(), deadline)),
                facilities(claims, island.id())));
        putPlayback(screen, parallel, context, claims, island.id());
        return missing(screen, "wallets");
    }

    /**
     * {@code focus} — 세션이 있으면 <b>세션이 고정한 섬</b>, 없으면 현재 섬을 연다. 세션이 있어도 섬 상세를
     * 반드시 읽는다(구현 §4 각주). 그 섬의 방송기가 완공이면 {@code playback} 을 읽는다.
     */
    public Map<String, Object> focus(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        Map<String, Object> first = composer.compose(context, List.of(
                fragment("session", deadline -> focus.current(claims, deadline))));
        FocusSessionState session = (FocusSessionState) first.get("session");
        IslandDetail island = session == null ? currentIsland(context, claims)
                : memberIsland(context, claims, session.islandId());
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        screen.putAll(first);
        Map<String, Object> parallel = composer.compose(context, List.of(
                fragment("focusMembers", deadline -> focusMembers.focusMembers(claims, island.id(), deadline)),
                facilities(claims, island.id())));
        putPlayback(screen, parallel, context, claims, island.id());
        return screen;
    }

    /**
     * {@code town-hall} — 역할 확인 뒤 방장이면 신청자 목록을 같은 병렬 단계에 더한다. 일반 주민은 신청자
     * 목록을 <b>부르지 않고</b> {@code host_only} 다. 역할 확인 뒤 위임돼 Data 가 403 을 주면 그 403 이 화면
     * 전체 오류다 — 옛 역할로 빈 목록을 지어내지 않는다(B03). 두 목록은 도메인 GET 과 같은 서명 커서를
     * 발행하므로 다음 페이지는 도메인 GET 이 이어받는다(B10). 빠진 조각: {@code wallets}.
     */
    public Map<String, Object> townHall(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        boolean host = switch (island.role()) {
            case ROLE_HOST -> true;
            case ROLE_MEMBER -> false;
            default -> throw new UpstreamContractMismatchException("섬 역할을 판별할 수 없습니다");
        };
        UUID islandId = island.id();
        List<ReadFragment<?>> fragments = new ArrayList<>(List.of(
                fragment("members", deadline -> management.members(claims, islandId, null,
                        IslandManagementUseCase.DEFAULT_LIMIT, deadline)),
                fragment("constructionOptions", deadline -> construction.options(claims, islandId, deadline))));
        if (host) {
            fragments.add(fragment("joinRequests", deadline -> management.joinRequests(claims, islandId, null,
                    IslandManagementUseCase.DEFAULT_LIMIT, deadline)));
        }
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        screen.putAll(composer.compose(context, fragments));
        if (!host) {
            screen.put("joinRequests", null);
        }
        screen.put("joinRequestsAvailability", host ? AVAILABLE : HOST_ONLY);
        return missing(screen, "wallets");
    }

    // ------------------------------------------------ 시설 화면 (GROMO-1898)
    //
    // 시설 게이트가 걸린 도메인 GET 이 있으면(게시판·방송기) 그 GET 의 도메인 403 이 곧 화면 전체 403 이다 —
    // mailbox 와 같은 규칙이다. 게이트 GET 이 없는 화면(상점·도서관)만 건설 옵션으로 완공을 먼저 판정한다.

    /**
     * {@code board} — 섬 문맥 뒤 현재 퀘스트·공지 첫 페이지를 병렬로 읽는다. 게시판 미완공은 두 도메인 GET 의
     * 게이트({@code QUEST_BOARD_LOCKED}·{@code BOARD_LOCKED})가 403 {@code FACILITY_LOCKED} 로 내고 그대로 화면
     * 전체 403 이다. 공지 커서는 도메인 GET 과 같은 서명 커서라 다음 페이지를 이어받는다(B10).
     * 빠진 조각: {@code wallets}(섬 상점 지갑 GET 없음).
     */
    public Map<String, Object> board(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        UUID islandId = island.id();
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        screen.putAll(composer.compose(context, List.of(
                fragment("quests", deadline -> quests.current(claims, islandId, deadline)),
                fragment("notices", deadline -> notices.list(claims, islandId, null, deadline)))));
        return missing(screen, "wallets");
    }

    /**
     * {@code library} — 섬 문맥 뒤 도서관 완공을 판정한다. 미완공이면 기록 조각을 부르지 않고 둘 다 null +
     * {@code statisticsAvailability:facility_locked}(B03 N, 화면은 200)다. 완공이면 집중·스크린타임 통계(GROMO-1769)를
     * 병렬로 읽는다 — 화면에는 query 가 없으므로 <b>이번 UTC 주(월~일)·scope=me</b> 첫 페이지다. 집중 기록 커서는
     * 도메인 GET 과 같은 서명 커서라 다음 페이지는 {@code GET /islands/{islandId}/statistics/focus} 가 이어받는다(B10).
     */
    public Map<String, Object> library(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        if (!completed(context, claims, island.id(), LIBRARY)) {
            screen.put("focusStatistics", null);
            screen.put("screenTimeStatistics", null);
            screen.put("statisticsAvailability", FACILITY_LOCKED);
            return screen;
        }
        UUID islandId = island.id();
        LocalDate monday = LocalDate.now(ZoneOffset.UTC).with(DayOfWeek.MONDAY);
        LocalDate sunday = monday.plusDays(6);
        screen.putAll(composer.compose(context, List.of(
                fragment("focusStatistics", deadline -> records.focus(claims, islandId, monday, sunday,
                        IslandRecordsUseCase.SCOPE_ME, null, deadline)),
                fragment("screenTimeStatistics", deadline -> records.screenTime(claims, islandId, monday, sunday,
                        IslandRecordsUseCase.SCOPE_ME, deadline)))));
        screen.put("statisticsAvailability", AVAILABLE);
        return screen;
    }

    /**
     * {@code shop} — 섬 문맥 뒤 상점 완공을 판정하고(미완공이면 화면 전체 403 {@code FACILITY_LOCKED}, 조각
     * 호출 없음) 공동 보유품을 읽는다. 빠진 조각: {@code wallets}·{@code products}(상점 GET 없음, 티켓 1781 은
     * 테이블만 있다).
     */
    public Map<String, Object> shop(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        UUID islandId = island.id();
        if (!completed(context, claims, islandId, SHOP)) {
            throw new PublicApiException(ApiErrorCode.FACILITY_LOCKED, null);
        }
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        screen.putAll(composer.compose(context, List.of(
                fragment("sharedInventory", deadline -> appearance.islandInventory(claims, islandId, deadline)))));
        return missing(screen, "wallets", "products");
    }

    /**
     * {@code playback} — 섬 문맥 뒤 공동 보유품·재생 상태를 병렬로 읽는다. 방송기 미완공은 재생 GET 의 게이트
     * ({@code GRAM_LOCKED})가 403 {@code FACILITY_LOCKED} 로 내고 그대로 화면 전체 403 이다. 빠진 조각:
     * {@code products}(판매 음원 {@code category=sound}, B20)·{@code wallets} — 상점 GET 이 없다.
     */
    public Map<String, Object> playback(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        UUID islandId = island.id();
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        screen.putAll(composer.compose(context, List.of(
                fragment("sharedInventory", deadline -> appearance.islandInventory(claims, islandId, deadline)),
                fragment("playback", deadline -> playback.get(claims, islandId, deadline)))));
        return missing(screen, "products", "wallets");
    }

    // ------------------------------------------------ 우체통·친구 화면 (GROMO-1899)

    /**
     * {@code mailbox} — 섬 문맥 뒤 섬 편지방 첫 페이지(Realtime)·받은 편지함 첫 페이지·친구 목록(Data)을 병렬로
     * 읽고, 편지방 작성자 이름을 이어서 붙인다(cross-service-mailbox 그림).
     *
     * <p>우체통 완공·주민 인가는 편지방 조각의 Data 인가({@code mailbox-access})와 편지함의 Data 게이트가 판정한다 —
     * 미완공·비주민의 도메인 403 은 그대로 화면 전체 403 이다(B03). 섬 상세에는 아직 시설 재료가 없어 여기서
     * 다시 검사하지 않는다.
     *
     * <p>작성자 표시 batch 는 POST 라 GET 전용 병렬 조합 밖에서, <b>같은 deadline</b> 으로 부른다. 그 장애는
     * 화면 전체 실패다 — 활성 작성자를 탈퇴자({@code name:null})로 바꿔 그리지 않는다(island-mailbox LLD §2).
     * 편지방·편지함 커서는 각 도메인 GET 이 발행하는 것과 같아 다음 페이지를 그대로 이어받는다(B10).
     */
    public Map<String, Object> mailbox(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        IslandDetail island = currentIsland(context, claims);
        UUID islandId = island.id();
        Map<String, Object> parts = composer.compose(context, List.of(
                fragment("messages", deadline -> mailbox.firstPage(claims, islandId, deadline)),
                fragment("letters", deadline -> letters.letters(claims, LETTERS_RECEIVED, null, null, deadline)),
                fragment("friends", deadline -> friends.friends(claims, null, deadline))));
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", island);
        screen.putAll(parts);
        screen.put("messages", mailbox.presentFirstPage(claims, islandId,
                (RealtimeHistory) parts.get("messages"), context.deadline()));
        return screen;
    }

    /**
     * {@code friends} — 친구 목록·받은 요청·보낸 요청 병렬. 현재 섬이 필요 없다. {@code date} 는 친구의 당일 집중
     * 분 기준일이며 도메인 {@code GET /friends} 에 그대로 넘긴다. 받은 요청 키는 raft 와 같은 {@code friendRequests}
     * 이고 보낸 요청은 {@code sentFriendRequests} 다.
     */
    public Map<String, Object> friends(AccessTokenClaims claims, String date, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        return composer.compose(context, List.of(
                fragment("friends", deadline -> friends.friends(claims, date, deadline)),
                fragment("friendRequests",
                        deadline -> friends.friendRequests(claims, FRIEND_REQUESTS_RECEIVED, deadline)),
                fragment("sentFriendRequests",
                        deadline -> friends.friendRequests(claims, FRIEND_REQUESTS_SENT, deadline))));
    }

    /** 섬 문맥 — 현재 섬 → 주민 상세. 현재 섬이 없으면 임의로 고르지 않는다(BG01). */
    private IslandDetail currentIsland(UpstreamRequestContext context, AccessTokenClaims claims) {
        MyIslandsResponse mine = (MyIslandsResponse) composer.compose(context, List.of(memberships(claims)))
                .get("memberships");
        if (mine.currentIslandId() == null) {
            throw new PublicApiException(ApiErrorCode.STATE_CONFLICT, "currentIslandId");
        }
        return memberIsland(context, claims, mine.currentIslandId());
    }

    /** 주민 상세만 받는다 — 방문자 요약이 오면(그 사이 소속을 잃음) 화면 전체 403 이다. */
    private IslandDetail memberIsland(UpstreamRequestContext context, AccessTokenClaims claims, UUID islandId) {
        Object island = composer.compose(context, List.of(
                fragment("island", deadline -> islands.island(claims, islandId, deadline)))).get("island");
        if (island instanceof IslandDetail detail) {
            return detail;
        }
        throw new PublicApiException(ApiErrorCode.FORBIDDEN, "islandId");
    }

    /**
     * 시설 완공 판정 재료 — 섬 상세에는 시설 필드가 아직 없어({@link IslandDetail} 주석) 건설 옵션을 쓴다.
     * 병렬 단계에 끼워 넣을 수 있게 조각으로 둔다.
     */
    private ReadFragment<?> facilities(AccessTokenClaims claims, UUID islandId) {
        return fragment(FACILITIES, deadline -> construction.options(claims, islandId, deadline));
    }

    /** 옵션 {@code items} 는 완공(COMPLETED)하지 않은 건물만 담으므로 목록에 없으면 완공이다. */
    private static boolean built(ConstructionOptions options, String building) {
        return options.items().stream().noneMatch(item -> building.equals(item.id()));
    }

    /** 시설 완공 판정을 단독 순차 단계로 — 판정 결과가 다음 조각의 호출 여부를 정할 때 쓴다. */
    private boolean completed(UpstreamRequestContext context, AccessTokenClaims claims, UUID islandId,
            String building) {
        return built((ConstructionOptions) composer.compose(context, List.of(facilities(claims, islandId)))
                .get(FACILITIES), building);
    }

    /**
     * 병렬 단계 결과를 화면에 옮기고(판정 재료는 빼고) {@code playback} 조각을 채운다. 미완공이면 호출을
     * 생략하고 {@code facility_locked} 다(B03 N). 완공 판정 뒤 받은 도메인 403({@code GRAM_LOCKED} 등)은
     * N 으로 접지 않고 화면 전체 실패다 — 완공은 되돌아가지 않으므로(BUILDING→COMPLETED 단방향) 판정과
     * 조회 사이 경합으로는 생기지 않는다.
     */
    private void putPlayback(Map<String, Object> screen, Map<String, Object> parallel,
            UpstreamRequestContext context, AccessTokenClaims claims, UUID islandId) {
        parallel.forEach((name, value) -> {
            if (!FACILITIES.equals(name)) {
                screen.put(name, value);
            }
        });
        if (!built((ConstructionOptions) parallel.get(FACILITIES), GRAM)) {
            screen.put("playback", null);
            screen.put("playbackAvailability", FACILITY_LOCKED);
            return;
        }
        screen.putAll(composer.compose(context, List.of(
                fragment("playback", deadline -> playback.get(claims, islandId, deadline)))));
        screen.put("playbackAvailability", AVAILABLE);
    }

    private static Map<String, Object> missing(Map<String, Object> screen, String... names) {
        for (String name : names) {
            screen.put(name, null);
        }
        screen.put(MISSING_FRAGMENTS, List.of(names));
        return screen;
    }

    // ---------------------------------------------------------------- 조각

    private ReadFragment<?> me(AccessTokenClaims claims) {
        return fragment("me", deadline -> account.me(claims, deadline));
    }

    private ReadFragment<?> memberships(AccessTokenClaims claims) {
        return fragment("memberships", deadline -> islands.myIslands(claims, deadline));
    }

    /** 필수 조각 하나. 조각은 공유 context 의 deadline 을 그대로 쓴다 — 다른 deadline 이면 조합기가 거절한다. */
    private static <T> ReadFragment<T> fragment(String name, Function<Deadline, T> read) {
        return new ReadFragment<>(name, true, new ParameterizedTypeReference<T>() { }, Set.of(),
                context -> read.apply(context.deadline()));
    }

    /** 주민 상세를 공개 요약 whitelist 로 줄인다. 주민에게는 가입 요청이 없으므로 joinRequestId 는 null 이다. */
    private static IslandSummary publicSummary(Object view) {
        if (view instanceof IslandSummary summary) {
            return summary;
        }
        if (view instanceof IslandDetail detail) {
            return new IslandSummary(detail.id(), detail.name(), detail.intro(), detail.visibility(),
                    detail.approvalRequired(), detail.memberCount(), detail.membershipStatus(), null,
                    detail.growthStage(), detail.themeId());
        }
        throw new UpstreamContractMismatchException("섬 조회 응답을 판별할 수 없습니다");
    }
}

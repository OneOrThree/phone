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
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.IslandDetail;
import com.oneorthree.business.upstream.data.dto.IslandSummary;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import lombok.RequiredArgsConstructor;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;

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
    private static final String AVAILABLE = "available";
    private static final String NONE = "none";
    private static final String HOST_ONLY = "host_only";
    private static final String ROLE_HOST = "host";
    private static final String ROLE_MEMBER = "member";
    private static final String MISSING_FRAGMENTS = "missingFragments";

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
     * {@code visit/{islandId}} — 공개 요약 뒤 본인 최신 가입 요청. 요청이 없으면 조회하지 않고
     * {@code joinRequestAvailability:none} 이다. 호출자가 주민이어도 공개 요약 projection 만 싣는다(LLD §1 조각 타입).
     */
    public Map<String, Object> visit(AccessTokenClaims claims, UUID islandId, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        Map<String, Object> first = composer.compose(context, List.of(
                fragment("island", deadline -> publicSummary(islands.island(claims, islandId, deadline)))));
        IslandSummary island = (IslandSummary) first.get("island");
        Map<String, Object> screen = new LinkedHashMap<>(first);
        if (island.joinRequestId() == null) {
            screen.put("joinRequestAvailability", NONE);
            screen.put("joinRequest", null);
            return screen;
        }
        Map<String, Object> second = composer.compose(context, List.of(fragment("joinRequest",
                deadline -> islands.joinRequest(claims, island.joinRequestId(), deadline))));
        JoinRequestStatus joinRequest = (JoinRequestStatus) second.get("joinRequest");
        if (!islandId.equals(joinRequest.islandId())) {
            throw new UpstreamContractMismatchException("가입 요청의 섬이 방문 섬과 다릅니다");
        }
        screen.put("joinRequestAvailability", AVAILABLE);
        screen.putAll(second);
        return screen;
    }

    // ------------------------------------------------ 섬 장소 화면 (GROMO-1897)
    //
    // 아직 도메인 GET 이 없는 조각은 호출하지 않고 명시 null 로 두며 missingFragments 에 이름을 싣는다.
    // 검증된 비적용(N)이 아니므로 …Availability 로 위장하지 않는다 — 그 값도 null 이다. 제공자가
    // 머지되면 해당 조각을 병렬 목록으로 옮기고 이름을 뺀다.

    /**
     * {@code home} — 섬 문맥 뒤 오늘 집중 요약·현재 세션을 병렬로 읽는다.
     *
     * <p>빠진 조각: {@code restMembers}(BG11 — 모닥불 휴식 주민을 홈에 보일지 미결), {@code wallets}(섬 상점
     * 지갑 GET 없음), {@code playback}(방송기 GET 과 시설 완공 재료가 둘 다 없어 {@code facility_locked} 도
     * 검증할 수 없다).
     */
    public Map<String, Object> home(AccessTokenClaims claims, String date, String timezone, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        Map<String, Object> screen = new LinkedHashMap<>();
        screen.put("island", currentIsland(context, claims));
        screen.putAll(composer.compose(context, List.of(
                fragment("focusSummary", deadline -> focus.summary(claims, date, timezone, deadline)),
                fragment("session", deadline -> focus.current(claims, deadline)))));
        screen.put("playbackAvailability", null);
        return missing(screen, "restMembers", "wallets", "playback");
    }

    /**
     * {@code focus} — 세션이 있으면 <b>세션이 고정한 섬</b>, 없으면 현재 섬을 연다. 세션이 있어도 섬 상세를
     * 반드시 읽는다(구현 §4 각주). 빠진 조각: {@code playback} — home 과 같은 이유다.
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
        screen.putAll(composer.compose(context, List.of(fragment("focusMembers",
                deadline -> focusMembers.focusMembers(claims, island.id(), deadline)))));
        screen.put("playbackAvailability", null);
        return missing(screen, "playback");
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

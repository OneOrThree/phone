package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.MyIslandsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.ReadFragment;
import com.oneorthree.business.common.http.ScreenComposer;
import com.oneorthree.business.common.http.UpstreamRequestContext;
import com.oneorthree.business.upstream.data.dto.IslandDetail;
import com.oneorthree.business.upstream.data.dto.IslandSummary;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import lombok.RequiredArgsConstructor;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;

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

    private final ScreenComposer composer;
    private final AccountUseCase account;
    private final IslandMembershipUseCase islands;
    private final FocusSessionUseCase focus;
    private final AppearanceUseCase appearance;
    private final FriendUseCase friends;
    private final NotificationApiClient notification;

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

package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.MyIslandsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.ReadFragment;
import com.oneorthree.business.common.http.ScreenComposer;
import com.oneorthree.business.common.http.UpstreamRequestContext;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.IslandDetail;
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
 * 섬 장소 화면 조회 3종 — {@code home} · {@code focus} · {@code town-hall} (GROMO-1897, bff-screens 구현 §4).
 *
 * <p>화면 전용 DTO 는 없다 — 조각 이름이 응답 키다(B26). 각 조각은 도메인 공개 GET 과 <b>같은 유스케이스</b>를
 * 불러 같은 공개 DTO·같은 오류 표를 쓴다. 그래서 도메인 403 은 조각 N 으로 접히지 않고 화면 전체 403 이 된다(B03).
 * 한 화면의 모든 단계(섬 문맥 → 병렬 조각)는 {@link ScreenComposer} 의 같은 context·deadline 을 쓴다(B24 ②).
 *
 * <p><b>아직 도메인 GET 이 없는 조각</b>은 호출하지 않고 {@code null} 로 두며 {@code missingFragments} 에
 * 이름을 올린다. 검증된 비적용(N)이 아니므로 {@code …Availability} 로 위장하지 않는다 — 그 값은 {@code null} 이다.
 * 제공자가 머지되면 해당 조각을 병렬 목록으로 옮기고 이름을 뺀다.
 */
// ponytail: 섬 장소 화면 한 클래스 — 다른 화면 묶음(1896 launch·raft·account·explore·visit)과 파일을 나눠 병렬 작업 충돌을 피한다.
@Service
@RequiredArgsConstructor
public class IslandScreenUseCase {

    private static final String MISSING_FRAGMENTS = "missingFragments";

    private static final String ROLE_HOST = "host";
    private static final String ROLE_MEMBER = "member";
    private static final String AVAILABLE = "available";
    private static final String HOST_ONLY = "host_only";

    private final ScreenComposer composer;
    private final IslandMembershipUseCase memberships;
    private final FocusSessionUseCase focusSessions;
    private final IslandFocusMembersUseCase focusMembers;
    private final IslandManagementUseCase management;
    private final IslandConstructionUseCase construction;

    /**
     * 섬 홈. 섬 문맥 뒤 오늘 집중 요약·현재 세션을 병렬로 읽는다.
     *
     * <p>빠진 조각: {@code restMembers}(BG11 — 모닥불 휴식 주민을 홈에 보일지 미결), {@code wallets}(섬 상점
     * 지갑 GET 없음), {@code playback}(방송기 GET 과 시설 완공 재료 둘 다 없음 — 완공 여부를 검증할 수 없어
     * {@code facility_locked} 도 쓸 수 없다).
     */
    public Map<String, Object> home(AccessTokenClaims claims, String requestId, String date, String timezone) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("island", currentIsland(context, claims));
        data.putAll(composer.compose(context, List.of(
                fragment("focusSummary", reads -> focusSessions.summary(claims, date, timezone, reads.deadline())),
                fragment("session", reads -> focusSessions.current(claims, reads.deadline())))));
        data.put("playbackAvailability", null);
        return missing(data, "restMembers", "wallets", "playback");
    }

    /**
     * 집중 화면. 세션이 있으면 그 세션의 섬, 없으면 현재 섬을 연다(세션이 있어도 섬 상세를 반드시 읽는다 — 구현 §4 각주).
     *
     * <p>빠진 조각: {@code playback} — 홈과 같은 이유다.
     */
    public Map<String, Object> focus(AccessTokenClaims claims, String requestId) {
        UpstreamRequestContext context = composer.start(requestId, claims.userId());
        FocusSessionState session = step(context, "session", reads -> focusSessions.current(claims, reads.deadline()));
        IslandDetail island = session == null ? currentIsland(context, claims)
                : memberIsland(context, claims, session.islandId());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("island", island);
        data.put("session", session);
        data.putAll(composer.compose(context, List.of(
                fragment("focusMembers", reads -> focusMembers.focusMembers(claims, island.id(), reads.deadline())))));
        data.put("playbackAvailability", null);
        return missing(data, "playback");
    }

    /**
     * 마을회관(섬 관리). 역할 확인 뒤 방장이면 신청자 목록을 같은 병렬 단계에 더한다.
     *
     * <p>일반 주민은 신청자 목록을 <b>부르지 않고</b> {@code host_only} 로 둔다. 역할 확인 뒤 위임돼 Data 가 403 을
     * 주면 그 403 이 화면 전체 오류다 — 옛 역할로 빈 목록을 지어내지 않는다. 목록 두 개는 도메인 GET 과 같은
     * 서명 커서를 발행하므로 다음 페이지는 도메인 GET 이 이어받는다(B10). 빠진 조각: {@code wallets}.
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
                fragment("members", reads -> management.members(claims, islandId, null,
                        IslandManagementUseCase.DEFAULT_LIMIT, reads.deadline())),
                fragment("constructionOptions", reads -> construction.options(claims, islandId, reads.deadline()))));
        if (host) {
            fragments.add(fragment("joinRequests", reads -> management.joinRequests(claims, islandId, null,
                    IslandManagementUseCase.DEFAULT_LIMIT, reads.deadline())));
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("island", island);
        data.putAll(composer.compose(context, fragments));
        if (!host) {
            data.put("joinRequests", null);
        }
        data.put("joinRequestsAvailability", host ? AVAILABLE : HOST_ONLY);
        return missing(data, "wallets");
    }

    /** 섬 문맥 — {@code GET /me/islands} 의 현재 섬 → 주민 상세. 현재 섬이 없으면 임의로 고르지 않는다(BG01). */
    private IslandDetail currentIsland(UpstreamRequestContext context, AccessTokenClaims claims) {
        MyIslandsResponse mine = step(context, "memberships", reads -> memberships.myIslands(claims, reads.deadline()));
        if (mine.currentIslandId() == null) {
            throw new PublicApiException(ApiErrorCode.STATE_CONFLICT, "currentIslandId");
        }
        return memberIsland(context, claims, mine.currentIslandId());
    }

    /** 주민 상세만 받는다 — 방문자 요약이 오면(그 사이 소속을 잃음) 화면 전체 403 이다. */
    private IslandDetail memberIsland(UpstreamRequestContext context, AccessTokenClaims claims, UUID islandId) {
        Object island = step(context, "island", reads -> memberships.island(claims, islandId, reads.deadline()));
        if (island instanceof IslandDetail detail) {
            return detail;
        }
        throw new PublicApiException(ApiErrorCode.FORBIDDEN, "islandId");
    }

    /** 앞 응답이 다음 호출을 정하는 순차 단계. 병렬 조각과 같은 context·deadline 을 쓴다. */
    @SuppressWarnings("unchecked")
    private <T> T step(UpstreamRequestContext context, String name, Function<UpstreamRequestContext, T> read) {
        return (T) composer.compose(context, List.of(fragment(name, read))).get(name);
    }

    /** 모든 조각은 필수다(B04) — 선택 조각은 B05 개정 전까지 두지 않는다. */
    private static <T> ReadFragment<T> fragment(String name, Function<UpstreamRequestContext, T> read) {
        return new ReadFragment<>(name, true, new ParameterizedTypeReference<T>() { }, Set.of(), read);
    }

    private static Map<String, Object> missing(Map<String, Object> data, String... names) {
        for (String name : names) {
            data.put(name, null);
        }
        data.put(MISSING_FRAGMENTS, List.of(names));
        return data;
    }
}

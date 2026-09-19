package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 여러 유저의 집중 라이브 정보(당일 집중분·진행중 여부·시작시각·태그명)를 한 번에 도출하는 공유 조회 컴포넌트 (GROMO-822).
 *
 * <p>친구 목록({@code FriendService.getFriends})이 사용하며 리그 랭킹(GROMO-824 예정)도 재사용한다.
 * userId 기반이라 도메인(friend/league)에 무관하다. {@code UserTierLookup}(GROMO-710)의 배치 조회 패턴을 미러한다.
 */
@Component
@RequiredArgsConstructor
public class FocusLiveInfoLookup {

    /**
     * 라이브 인정 최대 나이 — FocusService.ORPHAN_TIMEOUT(12h)과 동일 값. 이보다 오래된 미종료 세션은
     * 스윕 전 버려진(orphan) 세션으로 보고 '집중 중'에서 제외한다(GROMO-841 findUserIdsWithLiveSession 과 동일 기준).
     */
    private static final Duration LIVE_SESSION_MAX_AGE = Duration.ofHours(12);

    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;

    /**
     * 주어진 유저들의 집중 라이브 정보를 userId→FocusLiveInfo 맵으로 배치 도출한다.
     * 당일 집계도 없고 진행 중 세션도 없는 유저는 맵에서 빠진다(호출측이 get 시 기본값 0/false/null 처리).
     *
     * @param userIds 조회할 유저 ID 목록
     * @param date    당일 집계 기준 날짜(서버 판정 축 KST 고정 기준 오늘 — /pins 와 동일 기준, GROMO-1259)
     * @return userId→FocusLiveInfo 맵 (집계·라이브 둘 다 없는 유저는 미포함)
     */
    public Map<UUID, FocusLiveInfo> liveInfoByUserId(Collection<UUID> userIds, LocalDate date) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        // 당일 집중분: 초/60 내림(GROMO-642 계약과 동일)
        Map<UUID, Integer> focusMinutes = dailyFocusStatRepository.findByUserIdInAndDate(userIds, date).stream()
                .collect(Collectors.toMap(s -> s.getUser().getId(), s -> s.getTotalFocusSeconds() / 60));
        // 지금 집중 중(라이브) 세션 — 쿼리가 startedAt DESC 정렬이므로 중복 시작 세션이 있어도 toMap 이 먼저(=최신) 것을 유지.
        // liveSince(now-12h) 하한으로 스윕 전 orphan(버려진 미종료) 세션은 제외한다.
        Instant now = Instant.now();
        Instant liveSince = now.minus(LIVE_SESSION_MAX_AGE);
        Map<UUID, FocusSession> liveByUserId = focusSessionRepository.findLiveSessionsByUserIdIn(userIds, liveSince)
                .stream()
                .collect(Collectors.toMap(s -> s.getUser().getId(), Function.identity(), (existing, dup) -> existing));
        Map<UUID, Instant> liveAnchors = v03Anchors(liveByUserId.values(), now);
        liveByUserId.values().removeIf(live -> liveAnchors.containsKey(live.getId())
                && liveAnchors.get(live.getId()) == null);

        // 집계·라이브 어느 한쪽이라도 있는 유저만 맵에 담는다(둘 다 없으면 호출측 기본값 처리).
        Set<UUID> ids = new HashSet<>(focusMinutes.keySet());
        ids.addAll(liveByUserId.keySet());
        return ids.stream().collect(Collectors.toMap(Function.identity(), id -> {
            FocusSession live = liveByUserId.get(id);
            return new FocusLiveInfo(
                    focusMinutes.getOrDefault(id, 0),
                    live != null,
                    live != null ? liveAnchors.getOrDefault(live.getId(), live.getStartedAt()) : null,
                    live != null ? tagName(live) : null);
        }));
    }

    /**
     * v0.3 상세가 달린 라이브 세션의 표시 앵커 (GROMO-1924, 선행 조건 #4 · LLD §5.1) — 리그 라이브 순위
     * ({@code LeagueRankingQueryRepository.LIVE_SESSIONS})와 같은 규칙이다. 기본 마커는 휴식 중에도 열려 있어
     * {@code startedAt} 을 그대로 내보내면 앱이 휴식까지 «집중 중» 경과로 더한다.
     * <ul>
     *   <li>active — {@code now − 세션의 순수 ACTIVE 초}로 합성한다. 앱의 {@code now − 앵커}가 순수 집중이 된다</li>
     *   <li>paused — {@code null}(라이브 아님). 현행 응답으로는 고정된 진행분을 표시할 수 없다</li>
     * </ul>
     *
     * @return 상세가 있는 세션만 담은 sessionId → 앵커(휴식이면 null). 레거시 세션은 없다
     */
    private Map<UUID, Instant> v03Anchors(Collection<FocusSession> liveSessions, Instant now) {
        List<UUID> sessionIds = liveSessions.stream().map(FocusSession::getId).toList();
        Map<UUID, Instant> anchors = new HashMap<>();
        if (sessionIds.isEmpty()) {
            return anchors;
        }
        List<FocusSessionDetail> details = focusSessionDetailRepository.findAllById(sessionIds);
        if (details.isEmpty()) {
            return anchors;
        }
        Map<UUID, List<FocusSessionInterval>> intervals = focusSessionIntervalRepository
                .findBySessionIdIn(details.stream().map(FocusSessionDetail::getSessionId).toList()).stream()
                .collect(Collectors.groupingBy(FocusSessionInterval::getSessionId));
        for (FocusSessionDetail detail : details) {
            anchors.put(detail.getSessionId(), detail.getLifecycle() != FocusSessionLifecycle.ACTIVE ? null
                    : now.minusSeconds(FocusIntervalMath.activeSecondsAsOf(
                            intervals.getOrDefault(detail.getSessionId(), List.of()), now)));
        }
        return anchors;
    }

    /**
     * 진행 중 세션의 태그명 — 태그 미지정(focusTag null) 세션은 null.
     * focusTag(user_focus_tags)→defaultTag 는 조회 시 fetch join 되어 있어 여기서 추가 쿼리(N+1)가 없다.
     */
    private String tagName(FocusSession session) {
        return session.getFocusTag() != null ? session.getFocusTag().getDefaultTag().getName() : null;
    }
}

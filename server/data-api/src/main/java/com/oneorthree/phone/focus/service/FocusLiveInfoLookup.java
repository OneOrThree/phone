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
     * 라이브 인정 최대 나이. 12시간보다 오래된 미종료 세션은 집중 중 표시에서 제외한다.
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
     * @param date    당일 집계 기준 날짜(KST)
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
        // 시작 후 12시간을 넘긴 미종료 세션은 라이브 조회에서 제외한다.
        Instant now = Instant.now();
        Instant liveSince = now.minus(LIVE_SESSION_MAX_AGE);
        Map<UUID, FocusSession> liveByUserId = focusSessionRepository.findLiveSessionsByUserIdIn(userIds, liveSince)
                .stream()
                .collect(Collectors.toMap(s -> s.getUser().getId(), Function.identity(), (existing, dup) -> existing));
        List<FocusSessionDetail> details = focusSessionDetailRepository.findAllById(
                liveByUserId.values().stream().map(FocusSession::getId).toList());
        Map<UUID, FocusSessionDetail> detailsById = details.stream()
                .collect(Collectors.toMap(FocusSessionDetail::getSessionId, Function.identity()));
        Map<UUID, Instant> liveAnchors = currentAnchors(details, now);
        liveByUserId.values().removeIf(live -> liveAnchors.get(live.getId()) == null);

        // 집계·라이브 어느 한쪽이라도 있는 유저만 맵에 담는다(둘 다 없으면 호출측 기본값 처리).
        Set<UUID> ids = new HashSet<>(focusMinutes.keySet());
        ids.addAll(liveByUserId.keySet());
        return ids.stream().collect(Collectors.toMap(Function.identity(), id -> {
            FocusSession live = liveByUserId.get(id);
            return new FocusLiveInfo(
                    focusMinutes.getOrDefault(id, 0),
                    live != null,
                    live != null ? liveAnchors.getOrDefault(live.getId(), live.getStartedAt()) : null,
                    live != null ? detailsById.get(live.getId()).getSubject() : null);
        }));
    }

    /**
     * 집중 상세와 구간으로 계산하는 라이브 표시 앵커.
     *
     * <p>집중 중이면 현재 시각에서 누적 ACTIVE 초를 뺀 시각을 반환해 휴식 시간을 제외한다.
     * 휴식 중인 세션은 null을 반환한다. 상세가 없는 이전 기록은 결과에 포함하지 않는다.
     *
     * @return 상세가 있는 세션의 id와 표시 앵커
     */
    private Map<UUID, Instant> currentAnchors(List<FocusSessionDetail> details, Instant now) {
        Map<UUID, Instant> anchors = new HashMap<>();
        if (details.isEmpty()) {
            return anchors;
        }
        List<UUID> detailIds = details.stream().map(FocusSessionDetail::getSessionId).toList();
        Map<UUID, List<FocusSessionInterval>> intervals = focusSessionIntervalRepository
                .findBySessionIdInOrderByOrdinalAsc(detailIds).stream()
                .collect(Collectors.groupingBy(FocusSessionInterval::getSessionId));
        for (FocusSessionDetail detail : details) {
            anchors.put(detail.getSessionId(), detail.getLifecycle() != FocusSessionLifecycle.ACTIVE ? null
                    : now.minusSeconds(FocusIntervalMath.activeSecondsAsOf(
                            intervals.getOrDefault(detail.getSessionId(), List.of()), now)));
        }
        return anchors;
    }

}

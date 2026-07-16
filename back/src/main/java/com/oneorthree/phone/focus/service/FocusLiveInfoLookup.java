package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Collection;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 여러 유저의 집중 라이브 정보(당일 집중분·진행중 여부·시작시각·태그명)를 한 번에 도출하는 공유 조회 컴포넌트 (GROMO-822).
 *
 * <p>친구 목록({@code FriendService.getFriends})이 사용하며 리그 랭킹(GROMO-824 예정)도 재사용한다.
 * userId 기반이라 도메인(friend/league)에 무관하다. {@code LeagueTierLookup}(GROMO-710)의 배치 조회 패턴을 미러한다.
 */
@Component
@RequiredArgsConstructor
public class FocusLiveInfoLookup {

    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final FocusSessionRepository focusSessionRepository;

    /**
     * 주어진 유저들의 집중 라이브 정보를 userId→FocusLiveInfo 맵으로 배치 도출한다.
     * 당일 집계도 없고 진행 중 세션도 없는 유저는 맵에서 빠진다(호출측이 get 시 기본값 0/false/null 처리).
     *
     * @param userIds 조회할 유저 ID 목록
     * @param date    당일 집계 기준 날짜(클라 로컬 타임존 기준 오늘 — /pins 와 동일 기준)
     * @return userId→FocusLiveInfo 맵 (집계·라이브 둘 다 없는 유저는 미포함)
     */
    public Map<UUID, FocusLiveInfo> liveInfoByUserId(Collection<UUID> userIds, LocalDate date) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        // 당일 집중분: 초/60 내림(GROMO-642 계약과 동일)
        Map<UUID, Integer> focusMinutes = dailyFocusStatRepository.findByUserIdInAndDate(userIds, date).stream()
                .collect(Collectors.toMap(s -> s.getUser().getId(), s -> s.getTotalFocusSeconds() / 60));
        // 진행 중(미종료) 세션 — 유저당 최대 1개(앱 단일 라이브 세션 보장). 방어적으로 중복 시 먼저 조회된 것 유지.
        Map<UUID, FocusSession> liveByUserId = focusSessionRepository.findByUserIdInAndEndedAtIsNull(userIds).stream()
                .collect(Collectors.toMap(s -> s.getUser().getId(), Function.identity(), (existing, dup) -> existing));

        // 집계·라이브 어느 한쪽이라도 있는 유저만 맵에 담는다(둘 다 없으면 호출측 기본값 처리).
        Set<UUID> ids = new HashSet<>(focusMinutes.keySet());
        ids.addAll(liveByUserId.keySet());
        return ids.stream().collect(Collectors.toMap(Function.identity(), id -> {
            FocusSession live = liveByUserId.get(id);
            return new FocusLiveInfo(
                    focusMinutes.getOrDefault(id, 0),
                    live != null,
                    live != null ? live.getStartedAt() : null,
                    live != null ? tagName(live) : null);
        }));
    }

    // 진행 중 세션의 태그명 — 태그 미지정(focusTag null) 세션은 null.
    // focusTag(user_focus_tags)→defaultTag 는 조회 시 fetch join 되어 있어 여기서 추가 쿼리(N+1)가 없다.
    private String tagName(FocusSession session) {
        return session.getFocusTag() != null ? session.getFocusTag().getDefaultTag().getName() : null;
    }
}

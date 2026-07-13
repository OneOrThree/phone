package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 여러 유저의 현재 티어를 한 번에 도출하는 공유 조회 컴포넌트 (GROMO-710).
 * 티어는 league_arena_users.tier_level(현재 ACTIVE 아레나 멤버십)에서만 도출한다 (GROMO-671).
 * ProfileService#getPublicProfile 의 단건 티어 도출 로직을 배치(IN절)로 확장 — 친구 목록·요청·검색이 공유한다.
 */
@Component
@RequiredArgsConstructor
public class LeagueTierLookup {

    private final LeagueArenaUserRepository leagueArenaUserRepository;

    /**
     * 주어진 유저들의 현재 ACTIVE 아레나 티어를 userId→tierLevel 맵으로 배치 도출한다.
     * ACTIVE 멤버십이 없는 유저는 맵에서 빠진다(호출측이 get 시 null 로 처리).
     *
     * @param userIds 티어를 조회할 유저 ID 목록
     * @return userId→tierLevel 맵 (미소속 유저는 미포함)
     */
    public Map<UUID, Integer> tierLevelsByUserId(Collection<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return leagueArenaUserRepository
                .findByUserIdInAndArenaStatus(userIds, LeagueArenaStatus.ACTIVE).stream()
                // 유저당 ACTIVE 아레나는 최대 1개지만, 방어적으로 병합 함수를 둔다(먼저 온 값 유지).
                .collect(Collectors.toMap(
                        m -> m.getUser().getId(), LeagueArenaUser::getTierLevel, (a, b) -> a));
    }
}

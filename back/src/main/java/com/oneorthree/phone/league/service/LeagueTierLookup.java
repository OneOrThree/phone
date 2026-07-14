package com.oneorthree.phone.league.service;

import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserTierLevelProjection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 여러 유저의 현재 티어를 한 번에 도출하는 공유 조회 컴포넌트 (GROMO-710).
 * 티어의 단일 원천인 users.tier_level 을 배치(IN절)로 조회해 친구 목록·요청·검색이 공유한다 (GROMO-814).
 */
@Component
@RequiredArgsConstructor
public class LeagueTierLookup {

    private final UserRepository userRepository;

    /**
     * 주어진 유저들의 현재 티어를 userId→tierLevel 맵으로 배치 도출한다.
     * 존재하지 않거나 탈퇴한 유저 ID는 맵에서 빠진다(호출측이 get 시 null 로 처리).
     *
     * @param userIds 티어를 조회할 유저 ID 목록
     * @return userId→tierLevel 맵 (존재하지 않거나 탈퇴한 유저는 미포함)
     */
    public Map<UUID, Integer> tierLevelsByUserId(Collection<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return userRepository.findTierLevelsByIdInAndIsDeletedFalse(userIds).stream()
                .collect(Collectors.toMap(UserTierLevelProjection::id, UserTierLevelProjection::tierLevel));
    }
}

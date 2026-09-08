package com.oneorthree.phone.user.service;

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
 *
 * <p><b>league 에 있다가 user 로 왔다</b> (GROMO-1656). 이름은 리그를 가리켰지만 읽는 것은
 * {@code users.tier_level} 하나뿐이고 리그 테이블은 건드리지 않는다 — 실제 호출자도 친구 목록·
 * 요청·검색이지 리그가 아니었다. 그 위치 때문에 {@code friend → league} 참조가 생겨
 * 순환의 한 변이 됐다. 티어 값의 주인이 users 이므로 조회 컴포넌트도 여기 있는 것이 맞다.
 */
@Component
@RequiredArgsConstructor
public class UserTierLookup {

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

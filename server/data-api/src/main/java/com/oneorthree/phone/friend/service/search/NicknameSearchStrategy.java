package com.oneorthree.phone.friend.service.search;

import com.oneorthree.phone.user.service.UserTierLookup;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 닉네임 유사도(pg_trgm) 검색 전략. 정확 일치가 아니라 오타·부분 입력도 걸리게 하려는 선택이고,
 * 그 대신 결과가 넓어질 수 있어 상위 {@code SEARCH_LIMIT} 건으로 자른다.
 */
@Component
@RequiredArgsConstructor
public class NicknameSearchStrategy implements FriendSearchStrategy {

    private static final int SEARCH_LIMIT = 20;

    private final UserRepository userRepository;
    private final UserTierLookup userTierLookup;

    @Override
    public SearchType type() {
        return SearchType.NICKNAME;
    }

    /**
     * 닉네임 trgm 검색 원시 결과 반환. 자기자신(me) 제외·relation 표기는 FriendService 후처리.
     */
    @Override
    public List<FriendSearchResult> search(UUID me, String query) {
        List<User> matched = userRepository.searchByNicknameTrgm(query, SEARCH_LIMIT);
        // GROMO-710: 매칭 유저 id 들을 한 번에 모아 티어 배치 조회(N+1 방지). 티어는 league_arena_users 로만 도출(GROMO-671).
        Map<UUID, Integer> tierLevels = userTierLookup.tierLevelsByUserId(
                matched.stream().map(User::getId).toList());
        return matched.stream()
                .map(u -> FriendSearchResult.builder()
                        .userId(u.getId())
                        .nickname(u.getNickname())
                        .occupation(u.getOccupation() != null ? u.getOccupation().name() : null)
                        .tierLevel(tierLevels.get(u.getId()))
                        .build())
                .toList();
    }
}

package com.oneorthree.phone.friend.search;

import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class NicknameSearchStrategy implements FriendSearchStrategy {

    private static final int SEARCH_LIMIT = 20;

    private final UserRepository userRepository;

    @Override
    public SearchType type() {
        return SearchType.NICKNAME;
    }

    // 닉네임 trgm 검색 원시 결과 반환. 자기자신(me) 제외·relation 표기는 FriendService 후처리.
    @Override
    public List<FriendSearchResult> search(UUID me, String query) {
        return userRepository.searchByNicknameTrgm(query, SEARCH_LIMIT).stream()
                .map(u -> FriendSearchResult.builder()
                        .userId(u.getId())
                        .nickname(u.getNickname())
                        .tierLevel(u.getCurrentTier())
                        .build())
                .toList();
    }
}

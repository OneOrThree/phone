package com.oneorthree.phone.friend.search;

import com.oneorthree.phone.user.service.UserTierLookup;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.friend.service.search.FriendSearchResult;
import com.oneorthree.phone.friend.service.search.NicknameSearchStrategy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;

/**
 * NicknameSearchStrategy 단위 테스트 (GROMO-710).
 * 닉네임 검색 결과의 티어를 UserTierLookup 으로 배치 도출한다.
 */
@ExtendWith(MockitoExtension.class)
class NicknameSearchStrategyTest {

    @InjectMocks
    private NicknameSearchStrategy strategy;

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserTierLookup userTierLookup;

    private User user(UUID id, String nickname) {
        return User.builder().id(id).nickname(nickname).build();
    }

    @Test
    @DisplayName("검색 결과 — 아레나 소속과 무관하게 User 티어를 채움 (GROMO-814)")
    void search_restoresTierLevel_fromLeagueLookup() {
        UUID meId = UUID.randomUUID();
        UUID hasTierId = UUID.randomUUID();
        UUID noTierId = UUID.randomUUID();
        given(userRepository.searchByNicknameTrgm(eq("f"), anyInt()))
                .willReturn(List.of(user(hasTierId, "foo"), user(noTierId, "far")));
        given(userTierLookup.tierLevelsByUserId(List.of(hasTierId, noTierId)))
                .willReturn(Map.of(hasTierId, 5, noTierId, 1));

        List<FriendSearchResult> results = strategy.search(meId, "f");

        assertThat(results).filteredOn(r -> r.getUserId().equals(hasTierId))
                .extracting(FriendSearchResult::getTierLevel).containsExactly(5);
        assertThat(results).filteredOn(r -> r.getUserId().equals(noTierId))
                .extracting(FriendSearchResult::getTierLevel).containsExactly(1);
    }
}

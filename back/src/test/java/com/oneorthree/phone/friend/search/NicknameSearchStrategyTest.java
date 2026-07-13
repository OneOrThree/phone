package com.oneorthree.phone.friend.search;

import com.oneorthree.phone.league.service.LeagueTierLookup;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
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
 * 닉네임 검색 결과의 티어를 LeagueTierLookup 으로 배치 도출한다.
 */
@ExtendWith(MockitoExtension.class)
class NicknameSearchStrategyTest {

    @InjectMocks
    private NicknameSearchStrategy strategy;

    @Mock
    private UserRepository userRepository;

    @Mock
    private LeagueTierLookup leagueTierLookup;

    private User user(UUID id, String nickname) {
        return User.builder().id(id).nickname(nickname).build();
    }

    @Test
    @DisplayName("검색 결과 — 멤버십 있는 유저는 티어 채우고 미소속은 null (GROMO-710)")
    void search_restoresTierLevel_fromLeagueLookup() {
        UUID meId = UUID.randomUUID();
        UUID hasTierId = UUID.randomUUID();
        UUID noTierId = UUID.randomUUID();
        given(userRepository.searchByNicknameTrgm(eq("f"), anyInt()))
                .willReturn(List.of(user(hasTierId, "foo"), user(noTierId, "far")));
        given(leagueTierLookup.tierLevelsByUserId(List.of(hasTierId, noTierId)))
                .willReturn(Map.of(hasTierId, 6));

        List<FriendSearchResult> results = strategy.search(meId, "f");

        assertThat(results).filteredOn(r -> r.getUserId().equals(hasTierId))
                .extracting(FriendSearchResult::getTierLevel).containsExactly(6);
        assertThat(results).filteredOn(r -> r.getUserId().equals(noTierId))
                .extracting(FriendSearchResult::getTierLevel).containsExactly((Integer) null);
    }
}

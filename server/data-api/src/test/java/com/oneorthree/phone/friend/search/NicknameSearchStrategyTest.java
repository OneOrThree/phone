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
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * NicknameSearchStrategy 단위 테스트.
 *
 * <p>여기가 보는 것은 두 가지다: ① 전략이 «전체 일치» 조회 하나만 부른다(GROMO-1996)
 * ② 결과의 티어를 {@code UserTierLookup} 으로 도출한다(GROMO-710). 조회 자체의 대소문자·탈퇴자
 * 판정은 실제 DB 가 필요해 {@code FriendshipRepositoryTest} 가 맡는다.
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
        UUID foundId = UUID.randomUUID();
        given(userRepository.findActiveByNicknameIgnoreCase("foo"))
                .willReturn(Optional.of(user(foundId, "foo")));
        given(userTierLookup.tierLevelsByUserId(List.of(foundId))).willReturn(Map.of(foundId, 5));

        List<FriendSearchResult> results = strategy.search(meId, "foo");

        assertThat(results).singleElement()
                .extracting(FriendSearchResult::getUserId, FriendSearchResult::getTierLevel)
                .containsExactly(foundId, 5);
    }

    @Test
    @DisplayName("검색어의 앞뒤 공백은 떼고 찾는다 — 저장이 trim 이라 공백은 의미가 없다")
    void search_stripsQueryBeforeLookup() {
        UUID foundId = UUID.randomUUID();
        given(userRepository.findActiveByNicknameIgnoreCase("foo"))
                .willReturn(Optional.of(user(foundId, "foo")));
        given(userTierLookup.tierLevelsByUserId(List.of(foundId))).willReturn(Map.of());

        assertThat(strategy.search(UUID.randomUUID(), "  foo  ")).hasSize(1);
    }

    @Test
    @DisplayName("일치하는 유저가 없으면 빈 목록 — 티어 조회도 나가지 않는다")
    void search_noMatch_returnsEmptyWithoutTierLookup() {
        given(userRepository.findActiveByNicknameIgnoreCase("없는닉")).willReturn(Optional.empty());

        assertThat(strategy.search(UUID.randomUUID(), "없는닉")).isEmpty();
        verify(userTierLookup, never()).tierLevelsByUserId(org.mockito.ArgumentMatchers.anyList());
    }
}

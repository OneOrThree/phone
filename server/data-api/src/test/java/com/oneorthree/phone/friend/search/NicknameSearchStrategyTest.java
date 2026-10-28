package com.oneorthree.phone.friend.search;

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
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * NicknameSearchStrategy 단위 테스트.
 *
 * <p>전략이 전체 일치 조회만 호출하는지 검증한다. 대소문자·탈퇴자
 * 판정은 실제 DB 가 필요해 {@code FriendshipRepositoryTest} 가 맡는다.
 */
@ExtendWith(MockitoExtension.class)
class NicknameSearchStrategyTest {

    @InjectMocks
    private NicknameSearchStrategy strategy;

    @Mock
    private UserRepository userRepository;

    private User user(UUID id, String nickname) {
        return User.builder().id(id).nickname(nickname).build();
    }

    @Test
    @DisplayName("검색 결과 — 일치한 사용자 식별자와 닉네임 반환")
    void search_returnsMatchedUser() {
        UUID meId = UUID.randomUUID();
        UUID foundId = UUID.randomUUID();
        given(userRepository.findActiveByNicknameIgnoreCase("foo"))
                .willReturn(Optional.of(user(foundId, "foo")));

        List<FriendSearchResult> results = strategy.search(meId, "foo");

        assertThat(results).singleElement()
                .extracting(FriendSearchResult::getUserId, FriendSearchResult::getNickname)
                .containsExactly(foundId, "foo");
    }

    @Test
    @DisplayName("검색어의 앞뒤 공백은 떼고 찾는다 — 저장이 trim 이라 공백은 의미가 없다")
    void search_stripsQueryBeforeLookup() {
        UUID foundId = UUID.randomUUID();
        given(userRepository.findActiveByNicknameIgnoreCase("foo"))
                .willReturn(Optional.of(user(foundId, "foo")));

        assertThat(strategy.search(UUID.randomUUID(), "  foo  ")).hasSize(1);
    }

    @Test
    @DisplayName("일치하는 유저가 없으면 빈 목록")
    void search_noMatch_returnsEmpty() {
        given(userRepository.findActiveByNicknameIgnoreCase("없는닉")).willReturn(Optional.empty());

        assertThat(strategy.search(UUID.randomUUID(), "없는닉")).isEmpty();
    }
}

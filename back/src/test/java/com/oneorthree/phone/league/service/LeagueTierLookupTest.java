package com.oneorthree.phone.league.service;

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
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * LeagueTierLookup 단위 테스트 (GROMO-710).
 * users.tier_level 을 userId→tierLevel 맵으로 배치 도출한다.
 */
@ExtendWith(MockitoExtension.class)
class LeagueTierLookupTest {

    @InjectMocks
    private LeagueTierLookup leagueTierLookup;

    @Mock
    private UserRepository userRepository;

    private User user(UUID userId, int tierLevel) {
        return User.builder()
                .id(userId)
                .tierLevel(tierLevel)
                .build();
    }

    @Test
    @DisplayName("유저들의 users.tier_level 을 userId→tierLevel 맵으로 매핑")
    void tierLevelsByUserId_mapsUsers() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        given(userRepository.findAllByIdInAndIsDeletedFalse(List.of(a, b)))
                .willReturn(List.of(user(a, 3), user(b, 5)));

        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of(a, b));

        assertThat(result).containsOnly(Map.entry(a, 3), Map.entry(b, 5));
    }

    @Test
    @DisplayName("존재하지 않거나 탈퇴한 유저 ID는 맵에서 빠짐")
    void tierLevelsByUserId_omitsMissingOrDeletedUsers() {
        UUID existing = UUID.randomUUID();
        UUID missing = UUID.randomUUID();
        given(userRepository.findAllByIdInAndIsDeletedFalse(List.of(existing, missing)))
                .willReturn(List.of(user(existing, 2)));

        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of(existing, missing));

        assertThat(result).containsOnlyKeys(existing);
        assertThat(result.get(missing)).isNull();
    }

    @Test
    @DisplayName("빈 컬렉션 입력 → 빈 맵이고 repository 미호출")
    void tierLevelsByUserId_empty_noRepositoryCall() {
        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of());

        assertThat(result).isEmpty();
        verifyNoInteractions(userRepository);
    }

    @Test
    @DisplayName("아레나 미소속 신규 유저도 기본 티어 T1을 반환")
    void tierLevelsByUserId_newUserReturnsTierOne() {
        UUID newUserId = UUID.randomUUID();
        given(userRepository.findAllByIdInAndIsDeletedFalse(List.of(newUserId)))
                .willReturn(List.of(User.builder().id(newUserId).build()));

        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of(newUserId));

        assertThat(result).containsOnly(Map.entry(newUserId, 1));
    }
}

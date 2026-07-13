package com.oneorthree.phone.league.service;

import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.user.domain.User;
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
 * ACTIVE 아레나 멤버십 tier_level 을 userId→tierLevel 맵으로 배치 도출한다.
 */
@ExtendWith(MockitoExtension.class)
class LeagueTierLookupTest {

    @InjectMocks
    private LeagueTierLookup leagueTierLookup;

    @Mock
    private LeagueArenaUserRepository leagueArenaUserRepository;

    private LeagueArenaUser membership(UUID userId, int tierLevel) {
        return LeagueArenaUser.builder()
                .id(UUID.randomUUID())
                .user(User.builder().id(userId).build())
                .tierLevel(tierLevel)
                .build();
    }

    @Test
    @DisplayName("멤버십 있는 유저들 → userId→tierLevel 맵으로 매핑")
    void tierLevelsByUserId_mapsMembers() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        given(leagueArenaUserRepository.findByUserIdInAndArenaStatus(
                List.of(a, b), LeagueArenaStatus.ACTIVE))
                .willReturn(List.of(membership(a, 3), membership(b, 5)));

        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of(a, b));

        assertThat(result).containsOnly(Map.entry(a, 3), Map.entry(b, 5));
    }

    @Test
    @DisplayName("ACTIVE 멤버십 없는 유저는 맵에서 빠짐")
    void tierLevelsByUserId_omitsNonMembers() {
        UUID member = UUID.randomUUID();
        UUID nonMember = UUID.randomUUID();
        given(leagueArenaUserRepository.findByUserIdInAndArenaStatus(
                List.of(member, nonMember), LeagueArenaStatus.ACTIVE))
                .willReturn(List.of(membership(member, 2)));

        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of(member, nonMember));

        assertThat(result).containsOnlyKeys(member);
        assertThat(result.get(nonMember)).isNull();
    }

    @Test
    @DisplayName("빈 컬렉션 입력 → 빈 맵이고 repository 미호출")
    void tierLevelsByUserId_empty_noRepositoryCall() {
        Map<UUID, Integer> result = leagueTierLookup.tierLevelsByUserId(List.of());

        assertThat(result).isEmpty();
        verifyNoInteractions(leagueArenaUserRepository);
    }
}

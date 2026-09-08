package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

/**
 * 리그 마스터 데이터 조회 계층 (GROMO-1655).
 *
 * <p>PK 가 {@code Integer}(티어 등급)라는 것 자체가 계약이다 — 다른 계층은 전부 {@code UUID} 이므로
 * 이 시그니처가 조용히 바뀌면 호출부가 컴파일은 되면서 엉뚱한 키로 조회할 수 있다.
 *
 * <p>던지지 않는 것도 계약이다. 티어 설정은 배지 표시에만 쓰이므로 설정이 없다고 리그 응답 전체를
 * 404 로 만들면 안 된다.
 */
@ExtendWith(MockitoExtension.class)
class LeagueQueryServiceTest {

    private static final int TIER_LEVEL = 3;

    @Mock
    private LeagueTierConfigRepository leagueTierConfigRepository;

    @InjectMocks
    private LeagueQueryService leagueQueryService;

    @Mock
    private LeagueTierConfig tierConfig;

    @Test
    @DisplayName("티어 설정이 없어도 던지지 않는다 — 배지 표시용이라 리그 응답을 404 로 만들면 안 된다")
    void findTierConfigDoesNotThrowWhenAbsent() {
        given(leagueTierConfigRepository.findById(TIER_LEVEL)).willReturn(Optional.empty());

        assertThatCode(() -> leagueQueryService.findTierConfig(TIER_LEVEL)).doesNotThrowAnyException();
        assertThat(leagueQueryService.findTierConfig(TIER_LEVEL)).isEmpty();
    }

    @Test
    @DisplayName("티어 등급(Integer PK)으로 조회한다 — 다른 계층의 UUID 관용구가 아니다")
    void findTierConfigLooksUpByIntegerTierLevel() {
        given(leagueTierConfigRepository.findById(TIER_LEVEL)).willReturn(Optional.of(tierConfig));

        assertThat(leagueQueryService.findTierConfig(TIER_LEVEL)).contains(tierConfig);
        verify(leagueTierConfigRepository).findById(TIER_LEVEL);
    }
}

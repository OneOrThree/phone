package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Sort;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LeagueTierConfigRepositoryTest extends RepositoryTestBase {

    private static final int FOURTEEN_HOURS_IN_SECONDS = 14 * 60 * 60;

    @Autowired
    private LeagueTierConfigRepository leagueTierConfigRepository;

    @Test
    @DisplayName("티어 설정 저장 — 5개 티어의 승격·강등 임계값을 초 단위로 보존")
    void savesPromotionAndRelegationThresholds() {
        saveAllTierConfigs();

        List<LeagueTierConfig> configs = findAllOrderedByTierLevel();

        assertThat(configs).extracting(LeagueTierConfig::getBadgeId)
                .containsExactly("bbosirae", "preheat", "hyperfocus", "gatsaeng", "conqueror");
        assertThat(configs).extracting(LeagueTierConfig::getPromotionTime)
                .containsExactly(50400, 100800, 151200, 201600, 252000);
        assertThat(configs).extracting(LeagueTierConfig::getRelegationTime)
                .containsExactly(0, 50400, 100800, 151200, 201600);
    }

    @Test
    @DisplayName("티어 임계값 연속성 — 현재 티어 승격선과 다음 티어 강등선이 일치")
    void thresholdsAreContinuous() {
        saveAllTierConfigs();

        List<LeagueTierConfig> configs = findAllOrderedByTierLevel();

        assertThat(configs).hasSize(5);
        for (int index = 0; index < configs.size() - 1; index++) {
            assertThat(configs.get(index).getPromotionTime())
                    .isEqualTo(configs.get(index + 1).getRelegationTime());
        }
    }

    @Test
    @DisplayName("티어 임계값 누락 — 기본값 0으로 저장하지 않고 명시적으로 거부")
    void rejectsMissingThresholds() {
        LeagueTierConfig config = LeagueTierConfig.builder()
                .tierLevel(2)
                .arenaSize(30)
                .promoteCount(10)
                .relegateCount(5)
                .relegateWarningCount(3)
                .badgeId("preheat")
                .build();

        assertThatThrownBy(() -> leagueTierConfigRepository.saveAndFlush(config))
                .hasRootCauseInstanceOf(IllegalStateException.class)
                .hasRootCauseMessage("강등 임계값은 T1만 0일 수 있고 나머지는 양수여야 합니다.");
    }

    private List<LeagueTierConfig> findAllOrderedByTierLevel() {
        return leagueTierConfigRepository.findAll(Sort.by("tierLevel"));
    }

    private void saveAllTierConfigs() {
        List<String> badgeIds = List.of("bbosirae", "preheat", "hyperfocus", "gatsaeng", "conqueror");
        for (int tierLevel = 1; tierLevel <= badgeIds.size(); tierLevel++) {
            leagueTierConfigRepository.save(LeagueTierConfig.builder()
                    .tierLevel(tierLevel)
                    .arenaSize(30)
                    .promoteCount(10)
                    .relegateCount(5)
                    .relegateWarningCount(3)
                    .badgeId(badgeIds.get(tierLevel - 1))
                    .promotionTime(tierLevel * FOURTEEN_HOURS_IN_SECONDS)
                    .relegationTime((tierLevel - 1) * FOURTEEN_HOURS_IN_SECONDS)
                    .build());
        }
        leagueTierConfigRepository.flush();
    }
}

package com.oneorthree.phone.league.service;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 리그 주간 정산 배치의 시나리오 검증 — 단, 이 테스트는 {@link RepositoryTestBase} 의 주변
 * {@code @Transactional} 안에서 돌기 때문에 {@code LeagueAnchorRotator.rotate}·
 * {@code LeagueUserSettler.settle}(전파 REQUIRED)이 테스트 트랜잭션에 <b>합류</b>한다 —
 * 프로덕션의 건별 커밋/롤백 경계는 여기서 관측할 수 없다. 그 경계(유저 단위 롤백·커밋 가시성)에
 * 의존하는 단언은 {@link LeagueBatchWithdrawIntegrationTest}(IntegrationTestBase, 주변 트랜잭션
 * 없음 — 그 클래스 자바독 참조)에 둘 것.
 */
class LeagueBatchServiceTest extends RepositoryTestBase {

    private static final Instant BATCH_NOW = Instant.parse("2026-07-12T15:00:00Z");
    private static final Instant PREVIOUS_WEEK_START = Instant.parse("2026-07-05T15:00:00Z");
    private static final LocalDate PREVIOUS_MONDAY = LocalDate.of(2026, 7, 6);
    private static final LocalDate PREVIOUS_SUNDAY = LocalDate.of(2026, 7, 12);

    @Autowired
    LeagueBatchService leagueBatchService;
    @Autowired
    LeagueArenaRepository leagueArenaRepository;
    @Autowired
    LeagueTierConfigRepository leagueTierConfigRepository;
    @Autowired
    LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    DailyFocusStatRepository dailyFocusStatRepository;

    @BeforeEach
    void saveTierConfigs() {
        List<String> badges = List.of("bbosirae", "preheat", "hyperfocus", "gatsaeng", "conqueror");
        for (int tierLevel = 1; tierLevel <= badges.size(); tierLevel++) {
            leagueTierConfigRepository.save(LeagueTierConfig.builder()
                    .tierLevel(tierLevel)
                    .badgeId(badges.get(tierLevel - 1))
                    .promotionTime(tierLevel * 50_400)
                    .relegationTime((tierLevel - 1) * 50_400)
                    .build());
        }
        leagueTierConfigRepository.flush();
    }

    @Test
    @DisplayName("1~5티어 시간 임계값 표가 정산 계약과 일치한다")
    void tierThresholdTable() {
        Map<Integer, LeagueTierConfig> configs = leagueTierConfigRepository.findAll().stream()
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));

        assertThat(configs).hasSize(5);
        assertThat(configs.get(1)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(50_400, 0);
        assertThat(configs.get(2)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(100_800, 50_400);
        assertThat(configs.get(3)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(151_200, 100_800);
        assertThat(configs.get(4)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(201_600, 151_200);
        assertThat(configs.get(5)).extracting(
                LeagueTierConfig::getPromotionTime, LeagueTierConfig::getRelegationTime)
                .containsExactly(252_000, 201_600);
    }

    @Test
    @DisplayName("승격은 임계값 이상, 강등은 임계값 미만이며 T1/T5 경계를 넘지 않는다")
    void thresholdBoundariesAndEdgeTiers() {
        User tierOnePromotion = saveUser("tierOnePromotion", 1, false);
        User tierOneZero = saveUser("tierOneZero", 1, false);
        User tierTwoPromotion = saveUser("tierTwoPromotion", 2, false);
        User relegationEquality = saveUser("relegationEquality", 3, false);
        User belowRelegation = saveUser("belowRelegation", 3, false);
        User tierFive = saveUser("tierFive", 5, false);
        User tierTwoZero = saveUser("tierTwoZero", 2, false);
        saveStat(tierOnePromotion, PREVIOUS_MONDAY, 50_400);
        saveStat(tierTwoPromotion, PREVIOUS_MONDAY, 100_800);
        saveStat(relegationEquality, PREVIOUS_MONDAY, 100_800);
        saveStat(belowRelegation, PREVIOUS_MONDAY, 100_799);
        saveStat(tierFive, PREVIOUS_MONDAY, 999_999);
        flushFixtures();

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        Map<String, LeagueWeeklyResult> results = resultsByNickname();
        assertResult(results.get("tierOnePromotion"), LeagueWeeklyResultType.PROMOTED, 1, 2, 50_400);
        assertResult(results.get("tierOneZero"), LeagueWeeklyResultType.STAY, 1, 1, 0);
        assertResult(results.get("tierTwoPromotion"), LeagueWeeklyResultType.PROMOTED, 2, 3, 100_800);
        assertResult(results.get("relegationEquality"), LeagueWeeklyResultType.STAY, 3, 3, 100_800);
        assertResult(results.get("belowRelegation"), LeagueWeeklyResultType.RELEGATED, 3, 2, 100_799);
        assertResult(results.get("tierFive"), LeagueWeeklyResultType.STAY, 5, 5, 999_999);
        assertResult(results.get("tierTwoZero"), LeagueWeeklyResultType.RELEGATED, 2, 1, 0);
        assertThat(tierOnePromotion.getTierLevel()).isEqualTo(2);
        assertThat(tierFive.getTierLevel()).isEqualTo(5);
        assertThat(summary.settledMemberCount()).isEqualTo(7);
    }

    @Test
    @DisplayName("직전 KST 월요일~일요일만 합산하고 결과 키는 직전 주 월요일 Instant다")
    void previousKstWeekIsInclusiveAndStoredAsResultKey() {
        User user = saveUser("weeklyWindow", 3, false);
        saveStat(user, PREVIOUS_MONDAY.minusDays(1), 1_000_000);
        saveStat(user, PREVIOUS_MONDAY, 40_000);
        saveStat(user, PREVIOUS_SUNDAY, 70_000);
        saveStat(user, PREVIOUS_SUNDAY.plusDays(1), 1_000_000);
        flushFixtures();

        leagueBatchService.runWeeklyBatch(BATCH_NOW);

        LeagueWeeklyResult result = leagueWeeklyResultRepository.findAll().get(0);
        assertThat(result.getWeekStartAt()).isEqualTo(PREVIOUS_WEEK_START);
        assertResult(result, LeagueWeeklyResultType.STAY, 3, 3, 110_000);
    }

    @Test
    @DisplayName("이전 ACTIVE anchor를 모두 마감하고 현재 주 글로벌 anchor 한 행을 만든다")
    void endsPreviousActiveAnchorsAndCreatesOneGlobalAnchor() {
        LeagueArena first = saveAnchor(Instant.parse("2026-06-28T15:00:00Z"), LeagueArenaStatus.ACTIVE);
        LeagueArena second = saveAnchor(Instant.parse("2026-07-05T15:00:00Z"), LeagueArenaStatus.ACTIVE);

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(first.getStatus()).isEqualTo(LeagueArenaStatus.ENDED);
        assertThat(first.getEndedAt()).isEqualTo(BATCH_NOW);
        assertThat(second.getStatus()).isEqualTo(LeagueArenaStatus.ENDED);
        assertThat(second.getEndedAt()).isEqualTo(BATCH_NOW);
        List<LeagueArena> active = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        assertThat(active).singleElement().satisfies(anchor -> {
            assertThat(anchor.getStartedAt()).isEqualTo(BATCH_NOW);
            assertThat(anchor.getEndedAt()).isNull();
        });
        assertThat(summary.endedArenaCount()).isEqualTo(2);
        assertThat(summary.createdArenaCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("최초 실행에 활성 유저가 없어도 현재 주 anchor를 만들고 settled=0을 반환한다")
    void emptyUserDatabaseStillCreatesAnchor() {
        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        assertThat(summary.settledMemberCount()).isZero();
        assertThat(summary.createdArenaCount()).isEqualTo(1);
        assertThat(leagueWeeklyResultRepository.count()).isZero();
        assertThat(leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE))
                .singleElement()
                .extracting(LeagueArena::getStartedAt)
                .isEqualTo(BATCH_NOW);
    }

    @Test
    @DisplayName("현재 주 startedAt anchor가 있으면 결과와 anchor를 중복 생성하지 않는다")
    void rerunThrowsBatchAlreadyRunWithoutDuplicates() {
        User user = saveUser("rerun", 2, false);
        flushFixtures();
        leagueBatchService.runWeeklyBatch(BATCH_NOW);
        long resultCount = leagueWeeklyResultRepository.count();
        long arenaCount = leagueArenaRepository.count();

        assertThatThrownBy(() -> leagueBatchService.runWeeklyBatch(BATCH_NOW))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.BATCH_ALREADY_RUN);
        assertThat(leagueWeeklyResultRepository.count()).isEqualTo(resultCount);
        assertThat(leagueArenaRepository.count()).isEqualTo(arenaCount);
        assertThat(user.getTierLevel()).isEqualTo(1);
    }

    @Test
    @DisplayName("티어 설정이 1~5 중 하나라도 누락되면 정산 전에 TIER_CONFIG_NOT_FOUND")
    void missingTierConfigFailsBeforeAnySettlementWrite() {
        User user = saveUser("missingConfig", 2, false);
        flushFixtures();
        leagueTierConfigRepository.deleteById(4);
        leagueTierConfigRepository.flush();

        assertThatThrownBy(() -> leagueBatchService.runWeeklyBatch(BATCH_NOW))
                .isInstanceOf(LeagueException.class)
                .extracting(exception -> ((LeagueException) exception).getErrorCode())
                .isEqualTo(LeagueErrorCode.TIER_CONFIG_NOT_FOUND);
        assertThat(leagueWeeklyResultRepository.count()).isZero();
        assertThat(leagueArenaRepository.count()).isZero();
        assertThat(user.getTierLevel()).isEqualTo(2);
    }

    @Test
    @DisplayName("UUID 커서 페이지 경계에서도 활성 유저를 정확히 한 번 정산하고 삭제 유저를 제외한다")
    void cursorPaginationSettlesEveryActiveUserExactlyOnce() {
        int activeUserCount = LeagueBatchService.SETTLEMENT_PAGE_SIZE + 1;
        List<User> activeUsers = IntStream.range(0, activeUserCount)
                .mapToObj(index -> saveUser("paged" + index, 3, false))
                .toList();
        User deleted = saveUser("pagedDeleted", 3, true);
        saveStat(deleted, PREVIOUS_MONDAY, 999_999);
        flushFixtures();

        LeagueBatchSummaryResponse summary = leagueBatchService.runWeeklyBatch(BATCH_NOW);

        List<LeagueWeeklyResult> results = leagueWeeklyResultRepository.findAll();
        Set<UUID> resultUserIds = results.stream()
                .map(result -> result.getUser().getId())
                .collect(Collectors.toSet());
        assertThat(summary.settledMemberCount()).isEqualTo(activeUserCount);
        assertThat(results).hasSize(activeUserCount)
                .allSatisfy(result -> assertResult(result, LeagueWeeklyResultType.RELEGATED, 3, 2, 0));
        assertThat(resultUserIds).hasSize(activeUserCount)
                .containsExactlyInAnyOrderElementsOf(activeUsers.stream().map(User::getId).toList());
        assertThat(resultUserIds).doesNotContain(deleted.getId());
        // 삭제 유저는 집계 자체에서 빠지므로 skip/failed 어느 버킷에도 잡히지 않는다.
        assertThat(summary.skippedMemberCount()).isZero();
        assertThat(summary.failedMemberCount()).isZero();
    }

    private User saveUser(String nickname, int tierLevel, boolean deleted) {
        User user = userRepository.save(User.builder()
                .nickname(nickname)
                .tierLevel(tierLevel)
                .isDeleted(deleted)
                .build());
        // 승급 보너스 지급(credit)은 지갑을 전제로 하므로 프로덕션처럼 유저별 지갑을 함께 만든다.
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).build());
        return user;
    }

    private void saveStat(User user, LocalDate date, int seconds) {
        dailyFocusStatRepository.save(DailyFocusStat.builder()
                .user(user)
                .date(date)
                .totalFocusSeconds(seconds)
                .build());
    }

    private LeagueArena saveAnchor(Instant startedAt, LeagueArenaStatus status) {
        return leagueArenaRepository.save(LeagueArena.builder()
                .startedAt(startedAt)
                .status(status)
                .build());
    }

    private void flushFixtures() {
        userRepository.flush();
        dailyFocusStatRepository.flush();
    }

    private Map<String, LeagueWeeklyResult> resultsByNickname() {
        return leagueWeeklyResultRepository.findAll().stream()
                .collect(Collectors.toMap(result -> result.getUser().getNickname(), Function.identity()));
    }

    private void assertResult(
            LeagueWeeklyResult actual,
            LeagueWeeklyResultType result,
            int previousTier,
            int newTier,
            int focusSeconds) {
        assertThat(actual.getResult()).isEqualTo(result);
        assertThat(actual.getPreviousTierLevel()).isEqualTo(previousTier);
        assertThat(actual.getNewTierLevel()).isEqualTo(newTier);
        assertThat(actual.getFocusSeconds()).isEqualTo(focusSeconds);
    }
}
